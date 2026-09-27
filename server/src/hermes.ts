import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "./config.js";
import type { ChatEvent } from "./events.js";
import { parseSse } from "./sse.js";

/**
 * Hermes gateway API client. Prefers the Sessions API (`/api/sessions/{id}/chat/stream`)
 * and falls back to streaming Chat Completions with `X-Hermes-Session-Id` when the gateway
 * doesn't advertise session streaming. Everything leaving this module is a ChatEvent.
 */

type Mode = "sessions" | "completions";

export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
}

interface StoredSession {
  sessionId: string;
  mode: Mode;
}

const SESSION_TITLE = "JARVIS Dashboard";
const sessionFile = resolve(config.paths.dataDir, "session.json");

export class HermesError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text);
    const msg = body?.error?.message ?? body?.error ?? body?.message;
    if (typeof msg === "string") return msg;
  } catch {
    // not JSON
  }
  return text.slice(0, 300) || `HTTP ${res.status}`;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

function parseJson(data: string): Record<string, any> | null {
  try {
    const v = JSON.parse(data);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

class Hermes {
  mode: Mode | null = null;
  features: Record<string, unknown> = {};
  private sessionId: string | null = null;

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetch(`${config.hermes.url}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${config.hermes.apiKey}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      throw new HermesError("Hermes is offline (is `hermes gateway` running?)", 503);
    }
  }

  private async json(path: string, init: RequestInit = {}) {
    const res = await this.request(path, init);
    if (!res.ok) throw new HermesError(await errorMessage(res), res.status);
    return res.json() as Promise<Record<string, any>>;
  }

  /** Reads /v1/capabilities, logs it, and picks the streaming path. */
  async probe(): Promise<Mode> {
    const caps = await this.json("/v1/capabilities");
    this.features = (caps.features as Record<string, unknown>) ?? {};
    const on = Object.entries(this.features)
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    this.mode = this.features.session_chat_streaming ? "sessions" : "completions";
    console.log(`[hermes] capabilities: ${on.join(", ") || "(none advertised)"}`);
    console.log(`[hermes] streaming via ${this.mode === "sessions" ? "Sessions API" : "Chat Completions (fallback)"}`);
    return this.mode;
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${config.hermes.url}/health`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async ensureMode(): Promise<Mode> {
    return this.mode ?? (await this.probe());
  }

  private async saveSession(sessionId: string, mode: Mode) {
    this.sessionId = sessionId;
    await mkdir(config.paths.dataDir, { recursive: true });
    await writeFile(sessionFile, JSON.stringify({ sessionId, mode } satisfies StoredSession, null, 2));
  }

  private async createSession(): Promise<string> {
    const mode = await this.ensureMode();
    if (mode === "completions") {
      const id = `jarvis_${Date.now()}_${randomUUID().slice(0, 8)}`;
      await this.saveSession(id, mode);
      return id;
    }
    // Titles are unique in Hermes; later conversations get a timestamp suffix.
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    for (const title of [SESSION_TITLE, `${SESSION_TITLE} · ${stamp}`, `${SESSION_TITLE} · ${randomUUID().slice(0, 6)}`]) {
      const res = await this.request("/api/sessions", { method: "POST", body: JSON.stringify({ title }) });
      if (res.ok) {
        const body = (await res.json()) as Record<string, any>;
        const id = body?.session?.id ?? body?.id;
        if (typeof id !== "string") throw new HermesError("Hermes returned no session id");
        await this.saveSession(id, mode);
        console.log(`[hermes] created session ${id} ("${title}")`);
        return id;
      }
      const msg = await errorMessage(res);
      if (!(res.status === 400 && /title/i.test(msg))) throw new HermesError(msg, res.status);
    }
    throw new HermesError("Could not create a Hermes session");
  }

  /** The dashboard's current session, reused across restarts via data/session.json. */
  async ensureSession(): Promise<string> {
    if (this.sessionId) return this.sessionId;
    const mode = await this.ensureMode();
    try {
      const stored = JSON.parse(await readFile(sessionFile, "utf8")) as StoredSession;
      if (stored.sessionId && stored.mode === mode) {
        if (mode === "completions") return (this.sessionId = stored.sessionId);
        const res = await this.request(`/api/sessions/${encodeURIComponent(stored.sessionId)}`);
        if (res.ok) return (this.sessionId = stored.sessionId);
        if (res.status !== 404) throw new HermesError(await errorMessage(res), res.status);
        console.warn(`[hermes] stored session ${stored.sessionId} no longer exists; creating a new one`);
      }
    } catch (err) {
      if (err instanceof HermesError) throw err;
      // No session file yet.
    }
    return this.createSession();
  }

  async newSession(): Promise<string> {
    this.sessionId = null;
    return this.createSession();
  }

  async history(): Promise<HistoryMessage[]> {
    const id = await this.ensureSession();
    const res = await this.request(`/api/sessions/${encodeURIComponent(id)}/messages?order=latest&limit=200`);
    if (res.status === 404) return [];
    if (!res.ok) throw new HermesError(await errorMessage(res), res.status);
    const body = (await res.json()) as Record<string, any>;
    const rows: Record<string, any>[] = Array.isArray(body.data) ? body.data : [];
    // Present oldest-first whatever order the page arrives in (timestamp, then row id).
    const orderKey = (m: Record<string, any>, i: number) =>
      typeof m.timestamp === "number" ? m.timestamp : typeof m.id === "number" ? m.id : i;
    const messages = rows
      .map((m, i) => ({ m, key: orderKey(m, i) }))
      .sort((a, b) => a.key - b.key)
      .map(({ m }) => m)
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as HistoryMessage["role"], text: contentText(m.content).trim() }))
      .filter((m) => m.text);
    return messages;
  }

  /** Streams one turn as normalized events. `onRun` receives the Hermes run id (for stop/approval). */
  async *streamTurn(message: string, signal: AbortSignal, onRun: (runId: string) => void): AsyncGenerator<ChatEvent> {
    const mode = await this.ensureMode();
    const sessionId = await this.ensureSession();
    if (mode === "sessions") yield* this.streamSessions(sessionId, message, signal, onRun);
    else yield* this.streamCompletions(sessionId, message, signal, onRun);
  }

  private async *streamSessions(
    sessionId: string,
    message: string,
    signal: AbortSignal,
    onRun: (runId: string) => void,
  ): AsyncGenerator<ChatEvent> {
    const res = await this.request(`/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`, {
      method: "POST",
      body: JSON.stringify({ message }),
      headers: { Accept: "text/event-stream" },
      signal,
    });
    if (!res.ok || !res.body) throw new HermesError(await errorMessage(res), res.status);

    let runId = "";
    let streamed = "";
    let toolSeq = 0;
    const openTools: { id: string; name: string }[] = [];

    for await (const { event, data } of parseSse(res.body)) {
      const p = parseJson(data) ?? {};
      if (!runId && typeof p.run_id === "string") {
        runId = p.run_id;
        onRun(runId);
      }
      switch (event) {
        case "assistant.delta":
          if (typeof p.delta === "string" && p.delta) {
            streamed += p.delta;
            yield { type: "delta", text: p.delta };
          }
          break;
        case "assistant.commentary":
          if (!p.already_streamed && typeof p.text === "string") yield { type: "commentary", text: p.text };
          break;
        case "assistant.completed": {
          // Some paths (e.g. a live bot-chat handoff) deliver the reply only here.
          const content = contentText(p.content);
          if (!streamed && content) yield { type: "delta", text: content };
          break;
        }
        case "tool.started": {
          const name = String(p.tool_name ?? "tool");
          if (name.startsWith("_")) break;
          const id = `t${++toolSeq}`;
          openTools.push({ id, name });
          yield { type: "tool_start", id, name, label: typeof p.preview === "string" ? p.preview : undefined };
          break;
        }
        case "tool.completed":
        case "tool.failed": {
          const name = String(p.tool_name ?? "tool");
          const i = openTools.findIndex((t) => t.name === name);
          if (i === -1) break;
          const [tool] = openTools.splice(i, 1);
          yield { type: "tool_end", id: tool.id, name, ok: event === "tool.completed" };
          break;
        }
        case "approval.request":
          yield {
            type: "approval",
            command: String(p.command ?? ""),
            description: typeof p.description === "string" ? p.description : undefined,
            choices: Array.isArray(p.choices) ? p.choices.map(String) : ["once", "deny"],
          };
          break;
        case "run.completed":
          yield { type: "done", status: "completed" };
          return;
        case "run.cancelled":
          yield { type: "done", status: "cancelled" };
          return;
        case "run.failed":
          yield { type: "done", status: "failed", message: typeof p.error === "string" ? p.error : undefined };
          return;
        case "error":
          yield { type: "error", message: String(p.message ?? "Hermes reported an error") };
          return;
        case "done":
          return;
      }
    }
  }

  private async *streamCompletions(
    sessionId: string,
    message: string,
    signal: AbortSignal,
    onRun: (runId: string) => void,
  ): AsyncGenerator<ChatEvent> {
    const res = await this.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "hermes-agent", stream: true, messages: [{ role: "user", content: message }] }),
      headers: { Accept: "text/event-stream", "X-Hermes-Session-Id": sessionId },
      signal,
    });
    if (!res.ok || !res.body) throw new HermesError(await errorMessage(res), res.status);

    let runId = "";
    for await (const { event, data } of parseSse(res.body)) {
      if (data === "[DONE]") {
        yield { type: "done", status: "completed" };
        return;
      }
      const p = parseJson(data) ?? {};
      if (!runId && typeof p.id === "string") {
        runId = p.id; // the completion id doubles as the run id
        onRun(runId);
      }
      if (event === "hermes.tool.progress") {
        const id = String(p.toolCallId ?? p.tool);
        const name = String(p.tool ?? "tool");
        if (p.status === "running") yield { type: "tool_start", id, name, label: typeof p.label === "string" ? p.label : undefined };
        else yield { type: "tool_end", id, name, ok: p.status !== "failed" };
      } else if (event === "approval.request") {
        yield {
          type: "approval",
          command: String(p.command ?? ""),
          description: typeof p.description === "string" ? p.description : undefined,
          choices: Array.isArray(p.choices) ? p.choices.map(String) : ["once", "deny"],
        };
      } else if (event === "message") {
        if (p.error) {
          yield { type: "error", message: String(p.error.message ?? p.error) };
          return;
        }
        const content = p.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content) yield { type: "delta", text: content };
      }
    }
    yield { type: "done", status: "completed" };
  }

  /** Asks Hermes to interrupt a run. Returns false if the gateway doesn't support it. */
  async stop(runId: string): Promise<boolean> {
    if (this.features.run_stop === false) return false;
    const res = await this.request(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: "POST", body: "{}" });
    return res.ok;
  }

  async approve(runId: string, choice: string): Promise<void> {
    const res = await this.request(`/v1/runs/${encodeURIComponent(runId)}/approval`, {
      method: "POST",
      body: JSON.stringify({ choice }),
    });
    if (!res.ok) throw new HermesError(await errorMessage(res), res.status);
  }
}

export const hermes = new Hermes();
