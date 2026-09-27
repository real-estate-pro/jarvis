import { create } from "zustand";
import { onChatEvent, useChatStore } from "../chat/chatStore";
import { cancelListening, configureListening, isListening, startListening, stopListening } from "./listen";
import { voicePlayer } from "./player";
import { SentenceStream } from "./speechText";

/**
 * Voice output: when ON, replies are spoken sentence by sentence as they stream in
 * (persisted in localStorage; default OFF). Replies to *spoken* questions are always
 * spoken, and once JARVIS finishes answering one, the mic reopens for a follow-up — a
 * back-and-forth conversation without touching anything.
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
/** The next turn was asked out loud. */
let voiceTurnPending = false;
/** The current turn was asked out loud; reopen the mic once its answer has been spoken. */
let followUpArmed = false;
let spokeThisTurn = false;

export function stopSpeaking() {
  sentences = null;
  followUpArmed = false;
  voicePlayer.stop();
}

/**
 * Mic button: start listening, or finish the current take. Tapping while JARVIS is
 * talking cuts it off and listens (barge-in).
 */
export function toggleListening() {
  if (isListening()) {
    stopListening();
    return;
  }
  voicePlayer.unlock(); // the tap is our chance to unlock audio for the spoken answer
  stopSpeaking();
  void startListening();
}

export { cancelListening };

/** Once a spoken question's answer has been fully spoken, listen for a follow-up. */
function maybeFollowUp() {
  if (!followUpArmed || sentences || useChatStore.getState().busy) return;
  followUpArmed = false;
  if (spokeThisTurn) void startListening({ followUp: true });
}

function onTranscript(text: string) {
  const chat = useChatStore.getState();
  if (chat.busy) {
    // JARVIS is still working on something; keep the words so they can be sent next.
    useChatStore.setState({ draft: text, notice: "JARVIS is still working. Press send when ready." });
    return;
  }
  voiceTurnPending = true;
  void chat.send(text);
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

  voicePlayer.onSpeakingChange((speaking) => {
    if (speaking) spokeThisTurn = true;
    useVoiceStore.setState({ speaking });
  });
  voicePlayer.onError((err) => {
    sentences = null;
    followUpArmed = false;
    useChatStore.setState({ notice: `Voice unavailable: ${err.message}` });
  });
  voicePlayer.onIdle(maybeFollowUp);

  configureListening({
    onTranscript,
    onError: (message) => useChatStore.setState({ notice: message }),
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
      const spoken = voiceTurnPending && source === "live";
      voiceTurnPending = false;
      spokeThisTurn = false;
      followUpArmed = spoken;
      // Don't re-read a reply that is being replayed after a reconnect.
      if ((useVoiceStore.getState().enabled || spoken) && source === "live") {
        sentences = new SentenceStream((text) => voicePlayer.enqueue(text));
      }
      return;
    }
    if (!sentences) return;
    if (e.type === "delta") sentences.push(e.text);
    else if (e.type === "done") {
      if (e.status === "completed") sentences.end();
      else {
        followUpArmed = false;
        if (e.status === "cancelled") voicePlayer.stop();
      }
      sentences = null;
      // If the audio already finished before the turn closed, the idle hook has passed.
      if (voicePlayer.idle) setTimeout(maybeFollowUp, 0); // after the chat store marks the turn done
    } else if (e.type === "error") {
      sentences = null;
      followUpArmed = false;
    }
  });
}
