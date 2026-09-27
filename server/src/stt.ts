import { Hono } from "hono";
import { config } from "./config.js";

/**
 * POST /api/stt (raw audio body, e.g. audio/webm or audio/mp4) → {text}, via ElevenLabs
 * Scribe. Used when the browser has no built-in speech recognition. Nothing is stored.
 */
const MAX_BYTES = 10 * 1024 * 1024;

const usage = { day: "", requests: 0 };
function count() {
  const day = new Date().toISOString().slice(0, 10);
  if (usage.day !== day) Object.assign(usage, { day, requests: 0 });
  usage.requests++;
  console.log(`[stt] ${day}: ${usage.requests} transcriptions today`);
}

export const stt = new Hono();

stt.get("/", (c) => c.json({ available: !!config.elevenlabs.apiKey }));

stt.post("/", async (c) => {
  const { apiKey, sttModelId, url } = config.elevenlabs;
  if (!apiKey) return c.json({ error: "Speech recognition is not configured on the server" }, 503);

  const type = (c.req.header("content-type") ?? "audio/webm").split(";")[0];
  if (!type.startsWith("audio/")) return c.json({ error: "Expected an audio body" }, 415);
  const audio = await c.req.arrayBuffer();
  if (!audio.byteLength) return c.json({ error: "No audio" }, 400);
  if (audio.byteLength > MAX_BYTES) return c.json({ error: "Recording too long" }, 413);

  const ext = type.includes("mp4") || type.includes("aac") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";
  const form = new FormData();
  form.append("model_id", sttModelId);
  form.append("tag_audio_events", "false");
  form.append("file", new Blob([audio], { type }), `speech.${ext}`);

  let res: Response;
  try {
    res = await fetch(`${url}/v1/speech-to-text`, { method: "POST", headers: { "xi-api-key": apiKey }, body: form });
  } catch (err) {
    console.error("[stt] ElevenLabs unreachable:", (err as Error).message);
    return c.json({ error: "ElevenLabs is unreachable" }, 502);
  }
  const body = (await res.json().catch(() => null)) as Record<string, any> | null;
  if (!res.ok) {
    const d = body?.detail;
    const message = typeof d === "string" ? d : (d?.message ?? `ElevenLabs error ${res.status}`);
    console.error(`[stt] ${message}`);
    return c.json({ error: message }, 502);
  }
  count();
  return c.json({ text: typeof body?.text === "string" ? body.text.trim() : "" });
});
