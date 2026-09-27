import { useEffect, useRef, useState, type FormEvent } from "react";
import { useOrbStore } from "../state/orbStore";
import { useAuthStore, WELCOME_TEXT } from "./authStore";

function useCountdown(until: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : null;
}

function Typed({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((k) => (k >= text.length ? k : k + 1)), 38);
    return () => clearInterval(id);
  }, [text]);
  return (
    <span className="lock-typed">
      {text.slice(0, n)}
      <span className="stream-caret" />
    </span>
  );
}

export function LockScreen() {
  const { status, error, retryUntil, submitting, unlock } = useAuthStore();
  const layout = useOrbStore((s) => s.layout);
  const [value, setValue] = useState("");
  const [shake, setShake] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const countdown = useCountdown(retryUntil);

  useEffect(() => {
    if (error) setShake((k) => k + 1);
  }, [error]);

  useEffect(() => {
    if (status === "locked" && !countdown) input.current?.focus();
  }, [status, countdown]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!value || countdown) return;
    void unlock(value).then(() => setValue(""));
  };

  // Sit just below the orb.
  const place = layout.radius ? { top: layout.y + layout.radius * 1.02, left: layout.x } : undefined;
  const welcome = status === "welcome";

  return (
    <div className={`lock${welcome ? " welcome" : ""}`} style={place}>
      {status === "denied" ? (
        <div className="lock-title">ACCESS DENIED · OPEN THIS SITE THROUGH CLOUDFLARE ACCESS</div>
      ) : welcome ? (
        <Typed text={WELCOME_TEXT} />
      ) : status === "locked" ? (
        <form className="lock-form" onSubmit={onSubmit} key={shake} data-shake={shake > 0 || undefined}>
          <div className="lock-title">AUTHORIZATION REQUIRED</div>
          <div className="lock-field">
            <input
              ref={input}
              type="password"
              name="passphrase"
              autoComplete="current-password"
              aria-label="Passphrase"
              placeholder={countdown ? "LOCKED" : "PASSPHRASE"}
              value={value}
              disabled={!!countdown || submitting}
              onChange={(e) => setValue(e.target.value)}
            />
            <button className="hud-btn primary" type="submit" disabled={!value || !!countdown || submitting}>
              {submitting ? "…" : "ENTER"}
            </button>
          </div>
          <div className="lock-error" aria-live="assertive">
            {countdown ? `TOO MANY ATTEMPTS · TRY AGAIN IN ${countdown}` : error}
          </div>
        </form>
      ) : null}
    </div>
  );
}
