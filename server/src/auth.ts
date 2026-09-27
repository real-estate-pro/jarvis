import { createHash, timingSafeEqual } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import { verify } from "@node-rs/argon2";
import { Hono, type Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config.js";

/**
 * Two layers (CLAUDE.md §3):
 * 1. Cloudflare Access: every request must carry a valid Cf-Access-Jwt-Assertion for this
 *    app's AUD, signed by the team's keys. (DEV_BYPASS_ACCESS skips this locally only.)
 * 2. Passphrase: an argon2id-verified unlock sets a signed, HttpOnly, SameSite=Strict
 *    session cookie; every /api route except /api/auth/* requires it.
 */

// ---------- layer 1: Cloudflare Access ----------

const team = config.cfAccess.teamDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const jwks = team ? createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`)) : null;

export const accessGuard = createMiddleware(async (c, next) => {
  if (config.cfAccess.devBypass) return next();
  const token = c.req.header("cf-access-jwt-assertion");
  if (!token || !jwks || !config.cfAccess.aud) return c.text("Forbidden", 403);
  try {
    await jwtVerify(token, jwks, { issuer: `https://${team}`, audience: config.cfAccess.aud });
  } catch {
    return c.text("Forbidden", 403);
  }
  return next();
});

/** Blocks cross-site state changes (belt and braces on top of SameSite=Strict). */
export const originGuard = createMiddleware(async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("origin");
    const host = c.req.header("host");
    if (origin && host) {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {
        // malformed origin
      }
      if (originHost !== host) return c.json({ error: "Cross-origin request refused" }, 403);
    }
  }
  return next();
});

// ---------- layer 2: passphrase + session cookie ----------

const COOKIE = "jarvis_session";
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 3600 * 1000;

/** Changing the passphrase hash (or the secret) invalidates every existing session. */
const hashFingerprint = createHash("sha256").update(config.auth.passphraseHash).digest("hex").slice(0, 16);

async function hasSession(c: Context): Promise<boolean> {
  const value = await getSignedCookie(c, config.auth.sessionSecret, COOKIE);
  if (!value) return false;
  const [issued, fingerprint] = value.split(".");
  const issuedAt = Number(issued);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > SESSION_MS) return false;
  const a = Buffer.from(fingerprint ?? "");
  const b = Buffer.from(hashFingerprint);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const sessionGuard = createMiddleware(async (c, next) => {
  if (c.req.path.startsWith("/api/auth/")) return next();
  if (!(await hasSession(c))) return c.json({ error: "Locked" }, 401);
  return next();
});

// ---------- rate limiting: 5 attempts / 15 min per IP, then lockouts with backoff ----------

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const BASE_LOCKOUT_MS = 15 * 60 * 1000;
const MAX_LOCKOUT_MS = 24 * 3600 * 1000;

interface Attempts {
  failures: number[];
  lockedUntil: number;
  lockouts: number;
  lastSeen: number;
}
const attempts = new Map<string, Attempts>();

function clientIp(c: Context): string {
  // Behind the tunnel every socket is cloudflared on 127.0.0.1; Cloudflare supplies the caller.
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf;
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

function entry(ip: string): Attempts {
  let a = attempts.get(ip);
  if (!a) {
    a = { failures: [], lockedUntil: 0, lockouts: 0, lastSeen: 0 };
    attempts.set(ip, a);
  }
  a.lastSeen = Date.now();
  return a;
}

function recordFailure(a: Attempts, now: number) {
  a.failures = a.failures.filter((t) => now - t < WINDOW_MS);
  a.failures.push(now);
  if (a.failures.length >= MAX_FAILURES) {
    a.lockouts++;
    a.lockedUntil = now + Math.min(BASE_LOCKOUT_MS * 2 ** (a.lockouts - 1), MAX_LOCKOUT_MS);
    a.failures = [];
  }
}

// Forget idle entries so the map can't grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [ip, a] of attempts) {
    if (a.lockedUntil < now && now - a.lastSeen > MAX_LOCKOUT_MS) attempts.delete(ip);
  }
}, 3600 * 1000).unref();

export const auth = new Hono();

auth.get("/session", async (c) => ((await hasSession(c)) ? c.json({ ok: true }) : c.json({ error: "Locked" }, 401)));

auth.post("/unlock", async (c) => {
  const ip = clientIp(c);
  const a = entry(ip);
  const now = Date.now();
  if (a.lockedUntil > now) {
    const retryAfter = Math.ceil((a.lockedUntil - now) / 1000);
    c.header("Retry-After", String(retryAfter));
    return c.json({ error: "Too many attempts", retryAfter }, 429);
  }
  if (!config.auth.passphraseHash) {
    return c.json({ error: "No passphrase set up yet. Run `npm run hash-passphrase` on the Mac mini." }, 503);
  }

  const body = await c.req.json().catch(() => null);
  const passphrase = typeof body?.passphrase === "string" ? body.passphrase : "";
  let ok = false;
  if (passphrase && passphrase.length <= 1024) {
    try {
      ok = await verify(config.auth.passphraseHash, passphrase);
    } catch (err) {
      console.error("[auth] DASHBOARD_PASSPHRASE_HASH could not be read:", (err as Error).message);
      return c.json({ error: "The stored passphrase hash is invalid. Run `npm run hash-passphrase` again." }, 500);
    }
  }

  if (!ok) {
    recordFailure(a, now);
    const locked = a.lockedUntil > now;
    console.warn(`[auth] failed unlock from ${ip}${locked ? " — locked out" : ""}`);
    if (locked) {
      const retryAfter = Math.ceil((a.lockedUntil - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "Too many attempts", retryAfter }, 429);
    }
    return c.json({ error: "Access denied", remaining: MAX_FAILURES - a.failures.length }, 401);
  }

  attempts.delete(ip);
  console.log(`[auth] unlocked from ${ip}`);
  await setSignedCookie(c, COOKIE, `${now}.${hashFingerprint}`, config.auth.sessionSecret, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
  return c.json({ ok: true });
});

auth.post("/lock", (c) => {
  deleteCookie(c, COOKIE, { path: "/", secure: config.isProduction, sameSite: "Strict" });
  return c.json({ ok: true });
});
