import { useEffect, useRef, type KeyboardEvent } from "react";
import { setInputFocused } from "../orb/director";
import { useListenStore } from "../voice/listen";
import { cancelListening, stopSpeaking, toggleListening } from "../voice/voice";
import { useChatStore } from "./chatStore";

function MicButton() {
  const { phase, engine } = useListenStore();
  if (!engine) return null;
  const active = phase !== "off";
  return (
    <button
      className={`mic-btn${active ? " active" : ""}${phase === "transcribing" ? " busy" : ""}`}
      onClick={toggleListening}
      aria-label={active ? "Finish speaking" : "Talk to JARVIS"}
      aria-pressed={active}
      title={active ? "Tap to send now (Esc to cancel)" : "Talk to JARVIS"}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
      </svg>
    </button>
  );
}

export function InputBar({ onOpenHistory }: { onOpenHistory: () => void }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const text = useChatStore((s) => s.draft);
  const setText = (draft: string) => useChatStore.setState({ draft });
  const busy = useChatStore((s) => s.busy);
  const notice = useChatStore((s) => s.notice);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const newConversation = useChatStore((s) => s.newConversation);
  const { phase, interim, followUp } = useListenStore();
  const listening = phase !== "off";
  const shown = listening ? interim : text;

  // Grow with content, up to a few lines.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [shown]);

  // Esc cancels listening from anywhere.
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && cancelListening();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listening]);

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

  const status =
    phase === "listening" ? (followUp ? "LISTENING FOR A FOLLOW-UP…" : "LISTENING…") : phase === "transcribing" ? "TRANSCRIBING…" : null;

  return (
    <div className="input-dock">
      <div className="input-tools">
        {status ? <span className="input-status">{status}</span> : <span className="input-notice">{notice}</span>}
        <button className="hud-btn" onClick={onOpenHistory}>
          HISTORY
        </button>
        <button className="hud-btn" onClick={() => void newConversation()} disabled={busy}>
          NEW
        </button>
      </div>
      <div className={`input-line${busy ? " busy" : ""}${listening ? " listening" : ""}`}>
        <MicButton />
        <textarea
          ref={input}
          rows={1}
          value={shown}
          readOnly={listening}
          placeholder={listening ? "Listening…" : "Speak to JARVIS…"}
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
          <button
            className="hud-btn primary"
            onClick={() => {
              stopSpeaking();
              void stop();
            }}
            aria-label="Stop"
          >
            STOP
          </button>
        ) : (
          <button className="hud-btn primary" onClick={submit} disabled={!text.trim() || listening} aria-label="Send">
            SEND
          </button>
        )}
      </div>
    </div>
  );
}
