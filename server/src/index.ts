import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { accessGuard, auth, originGuard, sessionGuard } from "./auth.js";
import { chat } from "./chat.js";
import { assertSafeConfig, config } from "./config.js";
import { hermes } from "./hermes.js";
import { status } from "./status.js";
import { stt } from "./stt.js";
import { tts } from "./tts.js";

assertSafeConfig();

const app = new Hono();
const startedAt = Date.now();

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'self'"],
    },
    referrerPolicy: "no-referrer",
  }),
);
// Every request (UI included) must come through Cloudflare Access.
app.use("*", accessGuard);
app.use("/api/*", originGuard);
app.route("/api/auth", auth);
// Everything else under /api needs an unlocked session.
app.use("/api/*", sessionGuard);

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "jarvis-web",
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
  }),
);

app.route("/api/chat", chat);
app.route("/api/status", status);
app.route("/api/tts", tts);
app.route("/api/stt", stt);

app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

// Serve the built frontend in production (in dev, Vite serves it and proxies /api here).
if (existsSync(config.paths.webDist)) {
  const root = config.paths.webDist;
  // Hashed build assets never change; everything else (index.html) must revalidate so a
  // deploy shows up on the next load, including the home-screen app.
  app.use("/*", async (c, next) => {
    await next();
    if (c.res.ok && !c.res.headers.has("Cache-Control")) {
      c.header("Cache-Control", c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    }
  });
  app.use("/*", serveStatic({ root }));
  // SPA fallback.
  app.get("*", serveStatic({ root, path: "index.html" }));
} else {
  console.warn(`[web] ${config.paths.webDist} not found; run \`npm run build -w web\` to serve the UI from here.`);
}

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`[jarvis-web] listening on http://${info.address}:${info.port} (${config.nodeEnv})`);
});

if (!config.hermes.apiKey) console.warn("[hermes] HERMES_API_KEY is not set; Hermes will reject requests.");
hermes.probe().catch((err) => {
  console.warn(`[hermes] capability probe failed (${(err as Error).message}); will retry on first chat.`);
});
