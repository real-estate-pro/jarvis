/**
 * The normalized event stream the browser receives. The frontend never sees Hermes' wire
 * format; everything is mapped to these shapes in hermes.ts.
 */
export type ChatEvent =
  | { type: "start"; turnId: string; message: string }
  | { type: "delta"; text: string }
  | { type: "commentary"; text: string }
  | { type: "tool_start"; id: string; name: string; label?: string }
  | { type: "tool_end"; id: string; name: string; ok: boolean }
  | { type: "approval"; command: string; description?: string; choices: string[] }
  | { type: "done"; status: "completed" | "failed" | "cancelled"; message?: string }
  | { type: "error"; message: string };
