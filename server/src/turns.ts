import { randomUUID } from "node:crypto";
import type { ChatEvent } from "./events.js";
import { hermes, HermesError } from "./hermes.js";

/**
 * A turn runs server-side independently of the browser connection: if the phone locks
 * or the tab reloads mid-reply, Hermes keeps working and the browser can re-attach and
 * replay the turn so far (GET /api/chat/active).
 */
export class Turn {
  readonly id = randomUUID();
  readonly events: ChatEvent[] = [];
  done = false;
  runId: string | null = null;
  private readonly listeners = new Set<(e: ChatEvent) => void>();
  private readonly controller = new AbortController();
  private stopRequested = false;

  constructor(readonly message: string) {
    void this.run(message);
  }

  private emit(event: ChatEvent) {
    this.events.push(event);
    for (const fn of this.listeners) fn(event);
  }

  private async run(message: string) {
    this.emit({ type: "start", turnId: this.id, message });
    let ended = false;
    try {
      for await (const event of hermes.streamTurn(message, this.controller.signal, (id) => (this.runId = id))) {
        this.emit(event);
        if (event.type === "done" || event.type === "error") {
          ended = true;
          break;
        }
      }
      if (!ended) this.emit({ type: "done", status: "completed" });
    } catch (err) {
      if (this.stopRequested || (err as Error).name === "AbortError") {
        this.emit({ type: "done", status: "cancelled" });
      } else {
        const message = err instanceof HermesError ? err.message : "Lost connection to Hermes";
        console.error("[chat] turn failed:", err);
        this.emit({ type: "error", message });
      }
    } finally {
      this.done = true;
      this.listeners.clear();
      if (activeTurn === this) activeTurn = null;
    }
  }

  /** Replays everything so far, then streams live events. Returns an unsubscribe function. */
  subscribe(fn: (e: ChatEvent) => void): () => void {
    for (const e of this.events) fn(e);
    if (this.done) return () => {};
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async stop() {
    if (this.done || this.stopRequested) return;
    this.stopRequested = true;
    // Ask Hermes to interrupt cleanly (it then emits run.cancelled); fall back to dropping
    // the upstream connection, which Hermes also treats as an interrupt.
    const graceful = this.runId ? await hermes.stop(this.runId).catch(() => false) : false;
    if (!graceful) this.controller.abort();
    else setTimeout(() => this.controller.abort(), 15_000).unref();
  }
}

let activeTurn: Turn | null = null;

export function getActiveTurn(): Turn | null {
  return activeTurn;
}

export function startTurn(message: string): Turn {
  activeTurn = new Turn(message);
  return activeTurn;
}
