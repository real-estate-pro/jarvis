/** Mirrors server/src/events.ts — the normalized stream from /api/chat. */
export type ChatEvent =
  | { type: "start"; turnId: string; message: string }
  | { type: "delta"; text: string }
  | { type: "commentary"; text: string }
  | { type: "tool_start"; id: string; name: string; label?: string }
  | { type: "tool_end"; id: string; name: string; ok: boolean }
  | { type: "approval"; command: string; description?: string; choices: string[] }
  | { type: "done"; status: "completed" | "failed" | "cancelled"; message?: string }
  | { type: "error"; message: string };

export interface ToolRun {
  id: string;
  name: string;
  label?: string;
  status: "running" | "ok" | "failed";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: ToolRun[];
  commentary: string[];
  state: "streaming" | "done" | "cancelled" | "error";
  error?: string;
}

export interface Approval {
  command: string;
  description?: string;
  choices: string[];
}
