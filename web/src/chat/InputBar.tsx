import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { setInputFocused } from "../orb/director";
import { stopSpeaking } from "../voice/voice";
import { useChatStore } from "./chatStore";

export function InputBar({ onOpenHistory }: { onOpenHistory: () => void }) {
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const busy = useChatStore((s) => s.busy);
  const notice = useChatStore((s) => s.notice);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const newConversation = useChatStore((s) => s.newConversation);

  // Grow with content, up to a few lines.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const submit = () => {
    if (busy || !text.trim()) return;
    void send(text);
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="input-dock">
      <div className="input-tools">
        <span className="input-notice">{notice}</span>
        <button className="hud-btn" onClick={onOpenHistory}>
          HISTORY
        </button>
        <button className="hud-btn" onClick={() => void newConversation()} disabled={busy}>
          NEW
        </button>
      </div>
      <div className={`input-line${busy ? " busy" : ""}`}>
        <textarea
          ref={input}
          rows={1}
          value={text}
          placeholder="Speak to JARVIS…"
          aria-label="Message JARVIS"
          autoComplete="off"
          spellCheck
          enterKeyHint="send"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
        />
        {busy ? (
          <button className="hud-btn primary" onClick={() => {
              stopSpeaking();
              void stop();
            }}
            aria-label="Stop"
          >
            STOP
          </button>
        ) : (
          <button className="hud-btn primary" onClick={submit} disabled={!text.trim()} aria-label="Send">
            SEND
          </button>
        )}
      </div>
    </div>
  );
}
