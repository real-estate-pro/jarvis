# J.A.R.V.I.S. Dashboard — Build Spec (jarvisbykush.us)

You are building a private, single-user, web-based holographic interface for Kush's existing
Hermes Agent (Nous Research) running on his M2 Mac mini. The interface is a front end only —
Hermes remains the brain. Read this whole file before writing code. When a decision here is
marked **ASSUMED**, keep it unless Kush says otherwise.

---

## 1. Goals

1. Open `https://jarvisbykush.us` from any browser (desktop or iPhone) and reach a
   full-screen, cinematic, gold holographic "JARVIS" interface.
2. Only Kush can get in. No VPN / Tailscale. Cloudflare Access is the outer gate.
3. Text chat with Hermes, streamed token by token. The hologram reacts visually while
   JARVIS is thinking, using tools, and replying.
4. A voice toggle. When ON, replies are spoken with ElevenLabs voice ID
   `Fahco4VZzobUeiPqni1S`, and the hologram pulses to the actual audio amplitude.
5. When idle, the hologram is never static: slow, smooth, minimal, continuous motion.

Non-goals for v1: speech-to-text input, multi-user support, editing Hermes config from the UI.

---

## 2. Architecture

```
Browser (Safari/Chrome)
   │  HTTPS
   ▼
Cloudflare edge ── Cloudflare Access (policy: Kush's email only)
   │
   ▼  Cloudflare Tunnel (cloudflared on Mac mini, outbound-only, no open ports)
   │
Mac mini
 ├─ jarvis-web  (Node server, 127.0.0.1:4100)
 │    ├─ serves the built frontend (static)
 │    ├─ /api/auth/*   passphrase unlock (2nd factor, see §3)
 │    ├─ /api/chat     → proxies to Hermes, re-streams SSE to browser
 │    ├─ /api/tts      → proxies to ElevenLabs, streams audio to browser
 │    └─ /api/status   → Hermes /health + light system stats
 └─ Hermes gateway API server (127.0.0.1:8642, bearer auth)
```

Hard rules:
- **No secret ever reaches the browser.** `HERMES_API_KEY` and `ELEVENLABS_API_KEY` live only
  in the Node server's environment.
- Hermes stays bound to `127.0.0.1`. Do **not** enable `API_SERVER_CORS_ORIGINS`; the browser
  never talks to Hermes directly.
- jarvis-web binds to `127.0.0.1` only. cloudflared is the sole path in.
- The Hermes API exposes the agent's full toolset, including terminal commands, so this
  dashboard is effectively remote control of the Mac mini. Treat auth accordingly.

### Stack (ASSUMED)
- Frontend: Vite + React + TypeScript, `three` + `@react-three/fiber` + `@react-three/postprocessing`
  (Bloom), `zustand` for state. No UI kit; everything custom.
- Backend: Node 20+ with Hono (or Fastify), TypeScript.
- Process management: `launchd` plists for jarvis-web (Hermes gateway and cloudflared are
  already or separately managed — check before adding duplicates).
- Monorepo: `/web` (frontend), `/server` (backend), `/ops` (launchd plists, cloudflared config
  example, setup notes).

---

## 3. Authentication (two layers)

### Layer 1 — Cloudflare Access (outer gate, configured by Kush in the dashboard)
Cloudflare Access has no built-in "shared static password" login. Supported methods are
identity providers (Google, GitHub, etc.) and **One-time PIN** to an allowed email.
- Access application: self-hosted, hostname `jarvisbykush.us`.
- Policy: Allow → Emails → Kush's email only. Login method: Google or One-time PIN (ASSUMED:
  one-time PIN).
- Session duration: 30 days (so it isn't a daily chore).

### Layer 2 — In-app passphrase ("single password field")
After Access, the app shows a cinematic lock screen with a single passphrase field. This is
the password Kush generates.
- Server stores only an **argon2id hash** of the passphrase (`DASHBOARD_PASSPHRASE_HASH`).
  Provide a CLI script `npm run hash-passphrase` that prompts and prints the hash.
- On success: set an `HttpOnly; Secure; SameSite=Strict` signed session cookie (default 30 days).
- Rate limit: 5 attempts / 15 min per IP, then lockout with backoff.
- Every `/api/*` route (except `/api/auth/unlock`) requires the session cookie.

### Origin-side verification of Cloudflare Access
The server must also verify the `Cf-Access-Jwt-Assertion` header on every request against the
team's public keys (`https://<CF_ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`) and the app's AUD
tag (`CF_ACCESS_AUD`). Reject if missing/invalid. Provide `DEV_BYPASS_ACCESS=true` for local
development only; refuse to start with that flag if `NODE_ENV=production`.

---

## 4. Hermes integration

Hermes API server (already documented by Nous): enabled via `~/.hermes/.env`:
```
API_SERVER_ENABLED=true
API_SERVER_KEY=<long random>
```
Runs at `http://127.0.0.1:8642` when `hermes gateway` is running.

Implementation:
1. On boot, call `GET /v1/capabilities` (bearer auth) and log which features exist. Pick the
   streaming path based on what's advertised.
2. **Preferred path:** Sessions API.
   - Create/reuse a session for the dashboard (`POST /api/sessions`, store its id in a small
     local JSON file so it persists across restarts; title "JARVIS Dashboard").
   - Send turns with `POST /api/sessions/{id}/chat/stream` (SSE). Events include
     `assistant.delta`, `assistant.commentary`, `tool.started`, `tool.completed`, `tool.failed`,
     and a terminal `run.completed` / `run.failed` / `run.cancelled`.
   - History on load: `GET /api/sessions/{id}/messages`.
3. **Fallback path:** `POST /v1/chat/completions` with `stream: true` and an
   `X-Hermes-Session-Id` header; parse `chat.completion.chunk` plus the named
   `hermes.tool.progress` events.
4. SSE parsing: skip comment lines beginning with `:` (Hermes sends `: keepalive` every 10s).
5. Re-emit a **normalized** event stream to the browser:
   `{type: "delta"|"tool_start"|"tool_end"|"commentary"|"done"|"error", ...}`.
   The frontend never knows Hermes' wire format.
6. A "Stop" control calls the relevant stop/cancel endpoint if available.
7. "New conversation" creates a new session.

---

## 5. Voice (ElevenLabs)

- Env: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID=Fahco4VZzobUeiPqni1S`,
  `ELEVENLABS_MODEL_ID` (default a low-latency flash/turbo model; keep configurable).
  Voice ID must be read from env — never hardcoded — so it can be swapped if the voice ever
  becomes unavailable.
- Toggle in the top-right HUD: `VOICE ◉ ON / ○ OFF`. Persist the preference in localStorage.
  Default OFF. Turning it on is a user gesture — use that moment to create/resume the
  `AudioContext` (satisfies iOS autoplay rules).
- Pipeline: as `delta` text streams in, buffer into sentences; send each completed sentence to
  `/api/tts` (server streams from ElevenLabs' streaming TTS endpoint), queue the audio clips
  and play gaplessly. First audio should start after the first sentence, not the whole reply.
- Before TTS, strip markdown, code blocks (replace with "I've put the code on screen."),
  URLs (speak domain only), and emoji.
- All audio routes through an `AnalyserNode`. Expose a smoothed 0–1 amplitude value to the
  visual layer every frame (§6 "speaking" state).
- Toggling OFF mid-reply stops audio immediately and clears the queue.
- Server: cache nothing to disk; add a simple per-day character counter in logs so Kush can
  watch credit usage.

---

## 6. Visual design — Age of Ultron-style JARVIS

Reference: Kush's screenshot of the film's holographic JARVIS — a volumetric sphere of
glowing amber/gold light built from many layered, broken rings and arcs, streaks of
data, and fragmented glyphs, hanging in a dark space. Goal: as close to that feel as possible.
Build it procedurally (no film assets, video, or images).

### Palette
- Background: near-black with a faint cool blue-steel ambient (`#05080d` → `#0b1420`),
  soft vignette.
- Hologram: amber/gold. Core `#FFB02E`, mid `#FF8A00`, highlights `#FFE2A1`, hot white
  `#FFF6E0` for the brightest streaks. Occasional very faint cyan (`#6fd3ff` at <10% opacity)
  accents only in HUD chrome, never in the orb.
- All hologram materials: additive blending, depthWrite off, bloom does the glow.

### Orb composition (layered, each layer independently animated)
1. **Outer shell of broken rings** — 20–40 thin partial torus arcs (random arc lengths
   20°–300°), each on its own tilted axis, radius 0.9–1.0. Some dashed, some solid.
2. **Mid "data band" layer** — rings made of tiny rectangles/ticks (instanced), like
   circuit traces wrapped around a sphere. Individual segments randomly flicker brighter.
3. **Latitude/longitude fragments** — sparse partial meridians giving the sphere volume.
4. **Streak particles** — 2–5k instanced short line streaks orbiting on sphere shells,
   motion-stretched along their direction of travel (the "light trails" look).
5. **Inner core** — a smaller, brighter swirl: 2–4 spiral arcs rotating faster, plus a
   soft glowing nucleus.
6. **Floating glyph panels** — a few small translucent rectangles with micro text/bars
   (procedural, not real data) drifting at the sphere's edge, fading in and out.
7. **Scanline / noise pass** — very subtle film grain + faint horizontal scan shimmer.
8. Post: UnrealBloom (strength ~1.2–1.8, radius ~0.6, threshold low), slight chromatic
   aberration at edges, vignette.

### Motion states (drive everything from one `energy` uniform + per-state params, and
ease between states over ~400–800 ms; never snap)

| State | Trigger | Behavior |
|---|---|---|
| **Idle** | default | Layers rotate slowly at different speeds and directions (0.02–0.08 rad/s). Orb "breathes" ±1.5% scale on a ~6s sine. Random segment flickers at low rate. Particles drift. Always moving, never busy. |
| **Attentive** | user focuses/types in input | Orb brightens ~15%, outer rings slightly contract, a slow scanning sweep arc circles the orb. |
| **Thinking** | request sent, waiting | Inner core spins up, rings accelerate 2–3×, sweep speeds up, glyph panels flicker faster. |
| **Tool use** | `tool_start` event | Brief radial "ping" shockwave; a HUD tag appears near the orb with the tool name (e.g. `TERMINAL`, `WEB SEARCH`), fades on `tool_end`. |
| **Responding (text)** | `delta` events, voice OFF | Each chunk of tokens pulses energy (decaying envelope), so the orb visibly "talks" in rhythm with the text stream. |
| **Speaking (voice)** | audio playing, voice ON | Energy follows real audio amplitude: rings expand/contract, streak particles push outward on peaks, core brightens. Smooth with ~80 ms attack / 250 ms release. |
| **Error** | `error` event | Brief desaturation + small jitter, then return to idle. Stay gold (no red flashes). |

Motion rules: frame-rate independent (use delta time), no jank, no sudden jumps. Respect
`prefers-reduced-motion` with a calmer mode. Pause rendering when the tab is hidden.

### Layout
- Orb centered, ~60–70% of viewport height on desktop, ~80% width on mobile.
- Conversation: minimal floating text beneath/right of the orb in a thin monospace/tech
  typeface (e.g. "Rajdhani", "Orbitron" for labels, "JetBrains Mono" for body). JARVIS text
  types in as it streams, faint amber; user text dimmer, right-aligned. Only the last few
  exchanges visible; older ones fade upward; a subtle "history" drawer reveals the rest.
- Input: single thin glass line at the bottom with a blinking caret, placeholder
  "Speak to JARVIS…". Enter to send, Shift+Enter newline.
- Corners: small HUD readouts (time, Hermes status dot, Mac mini uptime/CPU/mem from
  `/api/status`, voice toggle). Thin lines, tick marks, tiny labels — minimal.
- Lock screen: the orb dim and slowly rotating; one passphrase field; on success the orb
  "powers up" (energy ramps, rings expand) and the HUD fades in. Text: "IDENTITY
  CONFIRMED. WELCOME BACK, SIR." (typed, and spoken if voice is on).

### Performance targets
- 60 fps on M-series Mac, ≥45 fps on recent iPhone Safari.
- Cap devicePixelRatio at 2; auto-reduce particle count if frame time > 22 ms for 2s.
- Use InstancedMesh / shaders; no per-frame allocations.

---

## 7. PWA / mobile
- Web app manifest + icons so it can be added to the iPhone home screen and launch full
  screen (`display: standalone`, black theme color).
- Handle safe-area insets; input stays above the keyboard.

---

## 8. Environment variables (`/server/.env`, never committed; provide `.env.example`)
```
NODE_ENV=production
PORT=4100
HERMES_API_URL=http://127.0.0.1:8642
HERMES_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=Fahco4VZzobUeiPqni1S
ELEVENLABS_MODEL_ID=
DASHBOARD_PASSPHRASE_HASH=
SESSION_SECRET=
CF_ACCESS_TEAM_DOMAIN=        # e.g. yourteam.cloudflareaccess.com
CF_ACCESS_AUD=
DEV_BYPASS_ACCESS=false
```

---

## 9. Ops (put working examples in `/ops` and a step-by-step `/ops/SETUP.md`)
1. Hermes: add `API_SERVER_ENABLED` / `API_SERVER_KEY` to `~/.hermes/.env`; restart gateway;
   verify with `curl` against `/health` and `/v1/capabilities`.
2. cloudflared: Kush may already run a tunnel on this Mac mini. **Check for an existing
   tunnel/config before creating a new one**; prefer adding an ingress rule:
   `hostname: jarvisbykush.us → service: http://127.0.0.1:4100`, plus a catch-all
   `http_status:404`. Ensure DNS route exists for the hostname.
3. Cloudflare Access: create the self-hosted app + policy (manual dashboard steps written
   out in SETUP.md), copy the AUD tag into `.env`.
4. launchd plist for jarvis-web (`KeepAlive`, logs to `~/Library/Logs/jarvis-web/`).
5. Mac mini must not sleep (Energy settings: prevent automatic sleep; start after power
   failure).

---

## 10. Build order / milestones
1. **Scaffold** repo, server with health route, frontend with black screen + FPS meter.
2. **Orb v1 (idle only)** — get the look right first. Kush reviews against the reference
   before anything else proceeds. Iterate here as long as needed.
3. **Chat plumbing** — server ↔ Hermes streaming, normalized events, basic text UI.
4. **State-driven animation** — wire thinking / tool / responding states.
5. **Voice** — TTS proxy, sentence queue, analyser-driven speaking state, toggle.
6. **Auth** — passphrase lock screen, cookie sessions, rate limit, Access JWT verification.
7. **Ops** — launchd, cloudflared ingress, SETUP.md, deploy.
8. **Polish** — PWA, reduced-motion, perf auto-scaling, HUD corner readouts.

## 11. Acceptance checklist
- [ ] Visiting the domain in a private window shows the Cloudflare Access login, not the app.
- [ ] After Access, the passphrase screen appears; wrong passphrase 5× → lockout.
- [ ] No API keys appear in any browser network response or bundle (grep the build).
- [ ] Hermes port 8642 and app port 4100 are not reachable from the LAN or internet directly.
- [ ] Idle orb moves continuously and smoothly for 10+ minutes without stutter or memory growth.
- [ ] Reply text streams; orb visibly reacts per state; tool names appear during tool use.
- [ ] Voice ON: speech starts within ~1–2 s of the first sentence; orb pulses to audio.
- [ ] Voice OFF mid-sentence stops audio instantly.
- [ ] Works on iPhone Safari and as a home-screen app.
