import { create } from "zustand";
import { onChatEvent, useChatStore } from "../chat/chatStore";
import { voicePlayer } from "./player";
import { SentenceStream } from "./speechText";

/**
 * Voice mode: when ON, replies are spoken sentence by sentence as they stream in.
 * The preference persists in localStorage; default OFF.
 */
const STORAGE_KEY = "jarvis.voice";

function readPref(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function writePref(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // storage unavailable (private mode); preference just won't persist
  }
}

interface VoiceState {
  enabled: boolean;
  /** Server has an ElevenLabs key configured. */
  available: boolean;
  speaking: boolean;
  toggle: () => void;
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  enabled: readPref(),
  available: true,
  speaking: false,
  toggle() {
    const enabled = !get().enabled;
    if (enabled) voicePlayer.unlock(); // inside the click: satisfies iOS autoplay rules
    else stopSpeaking();
    writePref(enabled);
    set({ enabled });
  },
}));

let sentences: SentenceStream | null = null;

export function stopSpeaking() {
  sentences = null;
  voicePlayer.stop();
}

/** Speak an arbitrary line (e.g. the unlock greeting) if voice is on. */
export function say(text: string) {
  if (!useVoiceStore.getState().enabled) return;
  voicePlayer.enqueue(text);
}

let started = false;

export function startVoice() {
  if (started) return;
  started = true;

  fetch("/api/tts", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => useVoiceStore.setState({ available: !!body?.available }))
    .catch(() => {});

  voicePlayer.onSpeakingChange((speaking) => useVoiceStore.setState({ speaking }));
  voicePlayer.onError((err) => {
    sentences = null;
    useChatStore.setState({ notice: `Voice unavailable: ${err.message}` });
  });

  // With voice already on from a previous visit, the first tap or key press unlocks audio.
  const unlockOnce = () => {
    if (useVoiceStore.getState().enabled) voicePlayer.unlock();
    window.removeEventListener("pointerdown", unlockOnce, true);
    window.removeEventListener("keydown", unlockOnce, true);
  };
  window.addEventListener("pointerdown", unlockOnce, true);
  window.addEventListener("keydown", unlockOnce, true);

  onChatEvent((e, source) => {
    if (e.type === "start") {
      stopSpeaking();
      // Don't re-read a reply that is being replayed after a reconnect.
      if (useVoiceStore.getState().enabled && source === "live") {
        sentences = new SentenceStream((text) => voicePlayer.enqueue(text));
      }
      return;
    }
    if (!sentences) return;
    if (e.type === "delta") sentences.push(e.text);
    else if (e.type === "done") {
      if (e.status === "completed") sentences.end();
      else if (e.status === "cancelled") voicePlayer.stop();
      sentences = null;
    } else if (e.type === "error") sentences = null;
  });
}
