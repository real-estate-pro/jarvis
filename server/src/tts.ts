import { Hono } from "hono";
import { stream } from "hono/streaming";
import { config } from "./config.js";

/**
 * POST /api/tts {text, previous_text?} → audio/mpeg streamed from ElevenLabs' streaming
 * TTS endpoint. The key never leaves the server and nothing is cached to disk.
 */
const MAX_CHARS = 600;

/** Per-day character count, logged so credit usage is easy to watch. */
const usage = { day: "", chars: 0 };
function countChars(n: number) {
  const day = new Date().toISOString().slice(0, 10);
  if (usage.day !== day) Object.assign(usage, { day, chars: 0 });
  usage.chars += n;
  console.log(`[tts] ${day}: ${usage.chars.toLocaleString()} chars today (+${n})`);
}

export const tts = new Hono();

tts.get("/", (c) => c.json({ available: !!(config.elevenlabs.apiKey && config.elevenlabs.voiceId) }));

tts.post("/", async (c) => {
  const { apiKey, voiceId, modelId, url } = config.elevenlabs;
  if (!apiKey || !voiceId) return c.json({ error: "Voice is not configured on the server" }, 503);

  const body = await c.req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const previous = typeof body?.previous_text === "string" ? body.previous_text.slice(-300) : undefined;
  if (!text) return c.json({ error: "No text" }, 400);
  if (text.length > MAX_CHARS) return c.json({ error: "Text too long" }, 413);

  let upstream: Response;
  try {
    upstream = await fetch(
      `${url}/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: modelId, ...(previous ? { previous_text: previous } : {}) }),
        signal: c.req.raw.signal,
      },
    );
  } catch (err) {
    if ((err as Error).name === "AbortError") return c.body(null, 204);
    console.error("[tts] ElevenLabs unreachable:", (err as Error).message);
    return c.json({ error: "ElevenLabs is unreachable" }, 502);
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    let message = `ElevenLabs error ${upstream.status}`;
    try {
      const d = JSON.parse(detail)?.detail;
      message = typeof d === "string" ? d : (d?.message ?? message);
    } catch {
      // keep generic message
    }
    console.error(`[tts] ${message}`);
    return c.json({ error: message }, upstream.status === 401 || upstream.status === 429 ? upstream.status : 502);
  }

  countChars(text.length);
  c.header("Content-Type", upstream.headers.get("content-type") ?? "audio/mpeg");
  c.header("Cache-Control", "no-store");
  const source = upstream.body;
  return stream(c, async (out) => {
    const reader = source.getReader();
    out.onAbort(() => void reader.cancel().catch(() => {}));
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      await out.write(value);
    }
  });
});
