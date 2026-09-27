import { useEffect, useRef } from "react";
import { ApprovalCard } from "./ApprovalCard";
import { useChatStore } from "./chatStore";
import { RichText } from "./RichText";
import type { ChatMessage, ToolRun } from "./types";
import { useTypewriter } from "./useTypewriter";

/** How many recent messages float beside the orb; the rest live in the history drawer. */
const VISIBLE = 6;

export function toolLabel(name: string) {
  return name.replace(/[_-]+/g, " ").toUpperCase();
}

function Tools({ tools }: { tools: ToolRun[] }) {
  if (!tools.length) return null;
  return (
    <div className="msg-tools">
      {tools.map((t) => (
        <span key={t.id} className={`tool-tag ${t.status}`} title={t.label}>
          <span className="tool-glyph">{t.status === "running" ? "◌" : t.status === "ok" ? "✓" : "✕"}</span>
          {toolLabel(t.name)}
          {t.label && <span className="tool-label">{t.label}</span>}
        </span>
      ))}
    </div>
  );
}

function Message({ m, live }: { m: ChatMessage; live: boolean }) {
  const text = useTypewriter(m.text, live && m.state === "streaming");
  if (m.role === "user") {
    return (
      <div className="msg user">
        <RichText text={m.text} />
      </div>
    );
  }
  const waiting = m.state === "streaming" && !m.text;
  return (
    <div className={`msg assistant ${m.state}`}>
      <Tools tools={m.tools} />
      {m.commentary.map((c, i) => (
        <div key={i} className="msg-commentary">
          {c}
        </div>
      ))}
      {waiting ? (
        <span className="msg-waiting">PROCESSING</span>
      ) : (
        <div className="msg-body">
          <RichText text={text} />
          {m.state === "streaming" && <span className="stream-caret" />}
        </div>
      )}
      {m.state === "cancelled" && <div className="msg-meta">— stopped</div>}
      {m.state === "error" && <div className="msg-meta">⚠ {m.error ?? "Something went wrong."}</div>}
    </div>
  );
}

export function Conversation() {
  const messages = useChatStore((s) => s.messages);
  const recent = messages.slice(-VISIBLE);
  return (
    <div className="conversation" aria-live="polite">
      {recent.map((m, i) => (
        <Message key={m.id} m={m} live={i === recent.length - 1} />
      ))}
      <ApprovalCard />
    </div>
  );
}

export function HistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const messages = useChatStore((s) => s.messages);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) end.current?.scrollIntoView();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="history" role="dialog" aria-label="Conversation history">
      <div className="history-head">
        <span>HISTORY</span>
        <button className="hud-btn" onClick={onClose}>
          CLOSE
        </button>
      </div>
      <div className="history-body">
        {messages.length === 0 && <div className="msg-meta">No messages in this session yet.</div>}
        {messages.map((m) => (
          <Message key={m.id} m={m} live={false} />
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}
