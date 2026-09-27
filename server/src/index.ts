import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { chat } from "./chat.js";
import { assertSafeConfig, config } from "./config.js";
import { hermes } from "./hermes.js";
import { status } from "./status.js";
import { stt } from "./stt.js";
import { tts } from "./tts.js";

assertSafeConfig();

const app = new Hono();
const startedAt = Date.now();

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
