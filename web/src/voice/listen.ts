import { create } from "zustand";
import { reportUnauthorized } from "../chat/api";

/**
 * Voice input. Two engines:
 * - "browser": the built-in SpeechRecognition (Safari → Apple, Chrome → Google). Live
 *   transcript while you talk, ends on its own when you pause.
 * - "recorder": records with MediaRecorder, detects the end of speech from the mic level,
 *   and transcribes on the server (/api/stt → ElevenLabs Scribe). Used where the browser
 *   has no recognizer, or when it refuses to run (e.g. some home-screen web apps).
 * Either way the finished transcript goes to `onTranscript`.
 */

type Engine = "browser" | "recorder";
export type ListenPhase = "off" | "listening" | "transcribing";

interface ListenState {
  phase: ListenPhase;
  /** Live words while listening (browser engine). */
  interim: string;
  engine: Engine | null;
  /** Opened automatically after JARVIS finished speaking (closes quietly on silence). */
  followUp: boolean;
}

export const useListenStore = create<ListenState>(() => ({
  phase: "off",
  interim: "",
  engine: null,
  followUp: false,
}));

// ---------- minimal SpeechRecognition typings (not in every lib.dom) ----------

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [i: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

const Recognizer: RecognitionCtor | undefined =
  typeof window !== "undefined"
    ? ((window as unknown as { SpeechRecognition?: RecognitionCtor }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition)
    : undefined;

const canRecord =
  typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

const isIOS =
  typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1));

/** Silence after speech that ends a take (ms). */
const END_OF_SPEECH_MS = 1300;
/** Give up if nothing is said (ms); shorter for follow-up listening. */
const NO_SPEECH_MS = 8000;
const FOLLOW_UP_NO_SPEECH_MS = 6000;
const MAX_TAKE_MS = 45_000;

let onTranscript: (text: string) => void = () => {};
let onError: (message: string) => void = () => {};
let serverStt = false;

export function configureListening(options: {
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}) {
  onTranscript = options.onTranscript;
  onError = options.onError;
  fetch("/api/stt", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((b) => {
      serverStt = !!b?.available;
      useListenStore.setState({ engine: pickEngine() });
    })
    .catch(() => {});
  useListenStore.setState({ engine: pickEngine() });
}

let preferRecorder = false;
function pickEngine(): Engine | null {
  if (Recognizer && !preferRecorder) return "browser";
  if (canRecord && serverStt) return "recorder";
  return Recognizer ? "browser" : null;
}

// ---------- mic level (for the orb) ----------

let meter: { ctx: AudioContext; analyser: AnalyserNode; samples: Float32Array<ArrayBuffer>; stream: MediaStream } | null = null;

function startMeter(stream: MediaStream) {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  meter = { ctx, analyser, samples: new Float32Array(analyser.fftSize), stream };
}

function stopMeter() {
  if (!meter) return;
  meter.stream.getTracks().forEach((t) => t.stop());
  void meter.ctx.close().catch(() => {});
  meter = null;
}

function rms(): number {
  if (!meter) return 0;
  meter.analyser.getFloatTimeDomainData(meter.samples);
  let sum = 0;
  for (let i = 0; i < meter.samples.length; i++) sum += meter.samples[i] * meter.samples[i];
  return Math.sqrt(sum / meter.samples.length);
}

/** Your voice level while listening, 0..1 (no allocation; call every frame). */
export function micLevel(): number {
  return useListenStore.getState().phase === "listening" ? Math.min(1, rms() * 6) : 0;
}

// ---------- session control ----------

let current: { stop: () => void; cancel: () => void } | null = null;

function finish(text: string) {
  current = null;
  stopMeter();
  useListenStore.setState({ phase: "off", interim: "", followUp: false });
  const clean = text.trim();
  if (clean) onTranscript(clean);
}

function fail(message: string | null) {
  current = null;
  stopMeter();
  useListenStore.setState({ phase: "off", interim: "", followUp: false });
  if (message) onError(message);
}

export function isListening() {
  return useListenStore.getState().phase !== "off";
}

/** Start listening. `followUp` = opened automatically; closes silently if you say nothing. */
export async function startListening(options: { followUp?: boolean } = {}) {
  if (current) return;
  const engine = pickEngine();
  if (!engine) {
    onError("Voice input isn't supported in this browser.");
    return;
  }
  const followUp = !!options.followUp;
  useListenStore.setState({ phase: "listening", interim: "", followUp, engine });
  if (engine === "browser") startBrowser(followUp);
  else await startRecorder(followUp);
}

/** Finish now and send what was heard. */
export function stopListening() {
  current?.stop();
}

/** Abandon without sending. */
export function cancelListening() {
  current?.cancel();
}

// ---------- engine: built-in recognizer ----------

function startBrowser(followUp: boolean) {
  const rec = new Recognizer!();
  rec.lang = navigator.language || "en-US";
  rec.interimResults = true;
  rec.continuous = true; // we decide when the take ends (Safari's own endpointing is erratic)
  rec.maxAlternatives = 1;

  let finalText = "";
  let interimText = "";
  let heard = false;
  let cancelled = false;
  let silence: ReturnType<typeof setTimeout> | undefined;
  const noSpeech = setTimeout(() => !heard && ((cancelled = true), rec.abort()), followUp ? FOLLOW_UP_NO_SPEECH_MS : NO_SPEECH_MS);
  const hardStop = setTimeout(() => rec.stop(), MAX_TAKE_MS);

  const armSilence = () => {
    clearTimeout(silence);
    silence = setTimeout(() => rec.stop(), END_OF_SPEECH_MS);
  };

  rec.onresult = (e) => {
    heard = true;
    // Rebuild from the full result list each time; Chrome and Safari differ in how they
    // report incremental updates, but both keep the whole utterance in `results`.
    finalText = "";
    interimText = "";
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interimText += r[0].transcript;
    }
    useListenStore.setState({ interim: `${finalText}${interimText}`.trim() });
    armSilence();
  };

  rec.onerror = (e) => {
    clearTimeout(silence);
    clearTimeout(noSpeech);
    clearTimeout(hardStop);
    if (e.error === "no-speech" || e.error === "aborted") return; // onend follows
    cancelled = true;
    if ((e.error === "service-not-allowed" || e.error === "network" || e.error === "language-not-supported") && canRecord && serverStt) {
      // The built-in recognizer is unavailable here (e.g. a home-screen web app); switch engines.
      preferRecorder = true;
      current = null;
      stopMeter();
      useListenStore.setState({ engine: "recorder" });
      void startRecorder(followUp);
      return;
    }
    fail(e.error === "not-allowed" ? "Microphone access was denied." : `Voice input error: ${e.error}`);
  };

  rec.onend = () => {
    clearTimeout(silence);
    clearTimeout(noSpeech);
    clearTimeout(hardStop);
    if (current?.stop !== stop) return; // superseded (engine switch)
    if (cancelled) fail(null);
    else finish(`${finalText}${interimText}`);
  };

  const stop = () => rec.stop();
  current = {
    stop,
    cancel: () => {
      cancelled = true;
      rec.abort();
    },
  };
  try {
    rec.start();
  } catch (err) {
    fail(`Voice input error: ${(err as Error).message}`);
    return;
  }
  // Level meter for the orb. On iOS a second mic capture can fight the recognizer; skip it.
  if (!isIOS && canRecord) {
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((stream) => {
        if (current?.stop === stop) startMeter(stream);
        else stream.getTracks().forEach((t) => t.stop());
      })
      .catch(() => {});
  }
}

// ---------- engine: record + server transcription ----------

function pickMime(): string {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"]) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return "";
}

async function startRecorder(followUp: boolean) {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    fail("Microphone access was denied.");
    return;
  }
  startMeter(stream);
  const mime = pickMime();
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  let cancelled = false;
  let heardFor = 0;
  let quietFor = 0;
  let elapsed = 0;
  const TICK = 50;
  const vad = setInterval(() => {
    elapsed += TICK;
    const level = rms();
    if (level > 0.02) {
      heardFor += TICK;
      quietFor = 0;
    } else if (level < 0.012) {
      quietFor += TICK;
    }
    const spoke = heardFor >= 150;
    if (spoke && quietFor >= END_OF_SPEECH_MS) end();
    else if (!spoke && elapsed >= (followUp ? FOLLOW_UP_NO_SPEECH_MS : NO_SPEECH_MS)) cancel();
    else if (elapsed >= MAX_TAKE_MS) end();
  }, TICK);

  const end = () => {
    clearInterval(vad);
    if (recorder.state !== "inactive") recorder.stop();
  };
  const cancel = () => {
    cancelled = true;
    end();
  };

  recorder.onstop = async () => {
    clearInterval(vad);
    stopMeter();
    if (cancelled || heardFor < 150) {
      fail(null);
      return;
    }
    useListenStore.setState({ phase: "transcribing" });
    try {
      const blob = new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" });
      const res = await fetch("/api/stt", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
      if (res.status === 401) reportUnauthorized();
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Transcription failed (${res.status})`);
      finish(body?.text ?? "");
    } catch (err) {
      fail((err as Error).message);
    }
  };

  current = { stop: end, cancel };
  recorder.start(250);
}
