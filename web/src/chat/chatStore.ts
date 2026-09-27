import { create } from "zustand";
import { ApiError, getJson, postJson, streamEvents } from "./api";
import type { Approval, ChatEvent, ChatMessage } from "./types";

interface ChatState {
  messages: ChatMessage[];
  /** A turn is running on the server. */
  busy: boolean;
  approval: Approval | null;
  /** Transient notice shown near the input (errors, "busy", etc.). */
  notice: string | null;
  /** Unsent text in the input box (typed, or a transcript held while JARVIS was busy). */
  draft: string;
  loadHistory: () => Promise<void>;
  send: (text: string) => Promise<void>;
  stop: () => Promise<void>;
  newConversation: () => Promise<void>;
  answerApproval: (choice: string) => Promise<void>;
}

let seq = 0;
const uid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

function message(role: ChatMessage["role"], text: string, state: ChatMessage["state"] = "done"): ChatMessage {
  return { id: uid(), role, text, tools: [], commentary: [], state };
}

/** Other modules (the orb, voice) can follow the live event stream. */
/** "attach" = replayed after re-attaching to a turn already in progress. */
export type EventSource = "live" | "attach";
type Listener = (e: ChatEvent, source: EventSource) => void;
const listeners = new Set<Listener>();
export function onChatEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const useChatStore = create<ChatState>((set, get) => {
  /** Applies one server event to the streaming assistant message (the last message). */
  function apply(e: ChatEvent, source: EventSource = "live") {
    for (const fn of listeners) fn(e, source);
    set((s) => {
      const messages = s.messages.slice();
      let last = messages[messages.length - 1];
      if (e.type === "start") {
        // A re-attach replays the turn from the beginning: drop the partial reply, and add
        // the user's message if history didn't include it yet.
        if (last?.role === "assistant" && last.state === "streaming") messages.pop();
        const tail = messages[messages.length - 1];
        if (!(tail?.role === "user" && tail.text === e.message)) messages.push(message("user", e.message));
        messages.push(message("assistant", "", "streaming"));
        return { messages, busy: true, approval: null };
      }
      if (!last || last.role !== "assistant") return {};
      last = { ...last };
      messages[messages.length - 1] = last;
      switch (e.type) {
        case "delta":
          last.text += e.text;
          return { messages, approval: null };
        case "commentary":
          last.commentary = [...last.commentary, e.text];
          return { messages };
        case "tool_start":
          last.tools = [...last.tools, { id: e.id, name: e.name, label: e.label, status: "running" }];
          return { messages };
        case "tool_end":
          last.tools = last.tools.map((t) => (t.id === e.id ? { ...t, status: e.ok ? "ok" : "failed" } : t));
          return { messages, approval: null };
        case "approval":
          return { approval: { command: e.command, description: e.description, choices: e.choices } };
        case "done":
          last.state = e.status === "completed" ? "done" : e.status === "cancelled" ? "cancelled" : "error";
          if (e.status === "failed") last.error = e.message ?? "The request failed.";
          last.tools = last.tools.map((t) => (t.status === "running" ? { ...t, status: e.status === "completed" ? "ok" : "failed" } : t));
          return { messages, busy: false, approval: null };
        case "error":
          last.state = "error";
          last.error = e.message;
          return { messages, busy: false, approval: null };
      }
    });
  }

  /** After a dropped connection (phone locked, network blip): re-sync from the server. */
  async function resync() {
    try {
      await get().loadHistory();
    } catch {
      set({ busy: false, notice: "Connection to JARVIS lost." });
    }
  }

  let attached = false;
  async function attach() {
    if (attached) return;
    attached = true;
    try {
      const streamed = await streamEvents("/api/chat/active", {}, (e) => apply(e, "attach"));
      if (!streamed) set({ busy: false });
    } catch {
      set({ busy: false });
    } finally {
      attached = false;
    }
  }

  return {
    messages: [],
    busy: false,
    approval: null,
    notice: null,
    draft: "",

    async loadHistory() {
      const { messages, busy } = await getJson<{ messages: { role: "user" | "assistant"; text: string }[]; busy: boolean }>(
        "/api/chat/history",
      );
      set({ messages: messages.map((m) => message(m.role, m.text)), busy, notice: null });
      if (busy) void attach();
    },

    async send(text) {
      const trimmed = text.trim();
      if (!trimmed || get().busy) return;
      set((s) => ({ messages: [...s.messages, message("user", trimmed)], busy: true, notice: null }));
      try {
        await streamEvents(
          "/api/chat",
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: trimmed }) },
          apply,
        );
        if (get().busy) await resync(); // stream ended without a terminal event
      } catch (err) {
        if (err instanceof ApiError) {
          set({ busy: err.status === 409, notice: err.message });
          if (err.status === 409) void attach();
        } else {
          await resync();
        }
      }
    },

    async stop() {
      await postJson("/api/chat/stop").catch(() => {});
    },

    async newConversation() {
      try {
        await postJson("/api/chat/new");
        set({ messages: [], notice: null, approval: null });
      } catch (err) {
        set({ notice: (err as Error).message });
      }
    },

    async answerApproval(choice) {
      set({ approval: null });
      try {
        await postJson("/api/chat/approval", { choice });
      } catch (err) {
        set({ notice: (err as Error).message });
      }
    },
  };
});
