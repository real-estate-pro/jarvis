import { onChatEvent } from "../chat/chatStore";
import type { ChatEvent } from "../chat/types";
import { debug } from "../debug";
import { useOrbStore } from "../state/orbStore";
import { useListenStore } from "../voice/listen";
import { useVoiceStore } from "../voice/voice";
import { drive, type OrbMode } from "./drive";

/**
 * Translates what JARVIS is doing (chat events, input focus) into orb states:
 * idle → attentive (typing) → thinking (waiting / tools) → responding (text streaming)
 * or speaking (voice playing), with a short error state that falls back to idle. Visual easing lives in drive.ts.
 */
const ERROR_HOLD_MS = 1300;
const TAG_FADE_MS = 700;

const state = {
  busy: false,
  streaming: false,
  focused: false,
  errorUntil: 0,
};

let errorTimer: ReturnType<typeof setTimeout> | undefined;

function modeNow(): OrbMode {
  if (Date.now() < state.errorUntil) return "error";
  if (useListenStore.getState().phase === "listening") return "listening";
  if (useVoiceStore.getState().speaking) return "speaking";
  if (state.busy) return state.streaming ? "responding" : "thinking";
  if (state.focused) return "attentive";
  return "idle";
}

function recompute() {
  drive.setMode(debug.forceMode ?? modeNow());
}

function showError() {
  state.errorUntil = Date.now() + ERROR_HOLD_MS;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(recompute, ERROR_HOLD_MS + 20);
}

const tags = () => useOrbStore.getState().setToolTags;

function endTag(id: string) {
  tags()((list) => list.map((t) => (t.id === id ? { ...t, phase: "ending" } : t)));
  setTimeout(() => tags()((list) => list.filter((t) => t.id !== id)), TAG_FADE_MS);
}

function endAllTags() {
  for (const t of useOrbStore.getState().toolTags) if (t.phase === "active") endTag(t.id);
}

function onEvent(e: ChatEvent) {
  switch (e.type) {
    case "start":
      state.busy = true;
      state.streaming = false;
      break;
    case "delta":
      state.streaming = true;
      // Each chunk kicks the envelope; bigger chunks kick harder. With voice on, the
      // real audio drives the orb instead.
      if (!useVoiceStore.getState().enabled) drive.pulse(0.14 + Math.min(0.3, e.text.length / 60));
      break;
    case "commentary":
      drive.pulse(0.2);
      break;
    case "tool_start":
      state.streaming = false;
      drive.ping();
      tags()((list) => [...list.filter((t) => t.id !== e.id), { id: e.id, name: e.name, label: e.label, phase: "active" }]);
      break;
    case "tool_end":
      endTag(e.id);
      break;
    case "done":
      state.busy = false;
      state.streaming = false;
      endAllTags();
      if (e.status === "failed") showError();
      break;
    case "error":
      state.busy = false;
      state.streaming = false;
      endAllTags();
      showError();
      break;
  }
  recompute();
}

let started = false;

export function startOrbDirector() {
  if (started) return;
  started = true;
  onChatEvent(onEvent);
  useVoiceStore.subscribe((s, prev) => {
    if (s.speaking !== prev.speaking) recompute();
  });
  useListenStore.subscribe((s, prev) => {
    if (s.phase !== prev.phase) recompute();
  });
  recompute();
}

export function setInputFocused(focused: boolean) {
  state.focused = focused;
  recompute();
}
