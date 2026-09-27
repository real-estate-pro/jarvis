import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ChatEvent } from "./events.js";
import { hermes, HermesError } from "./hermes.js";
import { getActiveTurn, startTurn, type Turn } from "./turns.js";

const MAX_MESSAGE_CHARS = 20_000;
const APPROVAL_CHOICES = new Set(["once", "session", "always", "deny"]);

export const chat = new Hono();

function streamTurn(c: Parameters<typeof streamSSE>[0], turn: Turn) {
  return streamSSE(c, async (stream) => {
    await new Promise<void>((resolve) => {
      // Writes are chained so the terminal event is flushed before the stream closes.
      let writes = Promise.resolve();
      const unsubscribe = turn.subscribe((event: ChatEvent) => {
        writes = writes.then(() => stream.writeSSE({ data: JSON.stringify(event) })).catch(() => {});
        if (event.type === "done" || event.type === "error") void writes.then(resolve);
      });
      // The browser going away does not stop the turn; it can re-attach later.
      stream.onAbort(() => {
        unsubscribe();
        resolve();
      });
    });
  });
}

function hermesError(c: { json: (body: unknown, status: any) => Response }, err: unknown) {
  const status = err instanceof HermesError ? err.status : 502;
  const message = err instanceof HermesError ? err.message : "Hermes request failed";
  if (!(err instanceof HermesError)) console.error("[chat]", err);
  return c.json({ error: message }, status >= 400 && status < 600 ? status : 502);
}

chat.get("/history", async (c) => {
  try {
    return c.json({ messages: await hermes.history(), busy: !!getActiveTurn() });
  } catch (err) {
    return hermesError(c, err);
  }
});

chat.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return c.json({ error: "Message is empty" }, 400);
  if (message.length > MAX_MESSAGE_CHARS) return c.json({ error: "Message is too long" }, 413);
  if (getActiveTurn()) return c.json({ error: "JARVIS is still working on the last request" }, 409);
  return streamTurn(c, startTurn(message));
});

chat.get("/active", (c) => {
  const turn = getActiveTurn();
  if (!turn) return c.body(null, 204);
  return streamTurn(c, turn);
});

chat.post("/stop", async (c) => {
  await getActiveTurn()?.stop();
  return c.json({ ok: true });
});

chat.post("/approval", async (c) => {
  const body = await c.req.json().catch(() => null);
  const choice = String(body?.choice ?? "");
  const runId = getActiveTurn()?.runId;
  if (!APPROVAL_CHOICES.has(choice)) return c.json({ error: "Invalid choice" }, 400);
  if (!runId) return c.json({ error: "Nothing is waiting for approval" }, 409);
  try {
    await hermes.approve(runId, choice);
    return c.json({ ok: true });
  } catch (err) {
    return hermesError(c, err);
  }
});

chat.post("/new", async (c) => {
  if (getActiveTurn()) return c.json({ error: "Stop the current request first" }, 409);
  try {
    await hermes.newSession();
    return c.json({ ok: true });
  } catch (err) {
    return hermesError(c, err);
  }
});
