import { create } from "zustand";
import { setUnauthorizedHandler } from "../chat/api";
import { powerUp, setLocked } from "../orb/director";
import { cancelListening } from "../voice/listen";
import { voicePlayer } from "../voice/player";
import { say, stopSpeaking, useVoiceStore } from "../voice/voice";

/**
 * checking → locked → (unlock) → welcome (orb powers up, greeting types out) → unlocked.
 * "denied" means Cloudflare Access rejected the request (open the site via Access).
 */
export type AuthStatus = "checking" | "locked" | "welcome" | "unlocked" | "denied";

export const WELCOME_TEXT = "IDENTITY CONFIRMED. WELCOME BACK, SIR.";
const WELCOME_MS = 2600;

interface AuthState {
  status: AuthStatus;
  error: string | null;
  /** Epoch ms until which unlock attempts are refused (lockout). */
  retryUntil: number;
  submitting: boolean;
  check: () => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  lock: () => Promise<void>;
}

function enterLocked(message: string | null = null) {
  stopSpeaking();
  cancelListening();
  setLocked(true);
  useAuthStore.setState({ status: "locked", error: message, submitting: false });
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "checking",
  error: null,
  retryUntil: 0,
  submitting: false,

  async check() {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (res.ok) {
        setLocked(false);
        set({ status: "unlocked", error: null });
      } else if (res.status === 403) {
        set({ status: "denied", error: null });
      } else {
        enterLocked();
      }
    } catch {
      enterLocked("Can't reach the server.");
    }
  },

  async unlock(passphrase) {
    if (get().submitting || Date.now() < get().retryUntil) return;
    // The Enter key / button press is a user gesture: unlock audio now for the greeting.
    if (useVoiceStore.getState().enabled) voicePlayer.unlock();
    set({ submitting: true, error: null });
    let res: Response;
    try {
      res = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
    } catch {
      set({ submitting: false, error: "Can't reach the server." });
      return;
    }
    const body = await res.json().catch(() => null);
    if (res.ok) {
      set({ status: "welcome", submitting: false, error: null, retryUntil: 0 });
      powerUp();
      say("Identity confirmed. Welcome back, sir.");
      setTimeout(() => set({ status: "unlocked" }), WELCOME_MS);
      return;
    }
    if (res.status === 429) {
      set({ submitting: false, retryUntil: Date.now() + (body?.retryAfter ?? 900) * 1000, error: null });
      return;
    }
    if (res.status === 401) {
      const left = body?.remaining;
      set({
        submitting: false,
        error: typeof left === "number" ? `ACCESS DENIED · ${left} ATTEMPT${left === 1 ? "" : "S"} LEFT` : "ACCESS DENIED",
      });
      return;
    }
    set({ submitting: false, error: body?.error ?? `Unlock failed (${res.status})` });
  },

  async lock() {
    await fetch("/api/auth/lock", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(
      () => {},
    );
    enterLocked();
  },
}));

setUnauthorizedHandler(() => {
  const { status } = useAuthStore.getState();
  if (status === "unlocked" || status === "welcome") enterLocked("Session ended. Enter your passphrase.");
});
