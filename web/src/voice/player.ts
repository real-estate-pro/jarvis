/**
 * Plays TTS clips back to back with no gaps, in order, while fetching ahead. All audio
 * runs through one AnalyserNode so the orb can follow the real speech amplitude.
 */
const MAX_IN_FLIGHT = 2;

export class TtsError extends Error {}

class VoicePlayer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Float32Array<ArrayBuffer> | null = null;
  private nextStart = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private readonly aborts = new Set<AbortController>();
  /** Bumped by stop(); clips from an older generation are dropped. */
  private generation = 0;
  private chain: Promise<void> = Promise.resolve();
  private inFlight = 0;
  private readonly waiting: (() => void)[] = [];
  private previousText = "";
  private readonly listeners = new Set<(speaking: boolean) => void>();
  private errorHandler: (err: Error) => void = () => {};

  onError(fn: (err: Error) => void) {
    this.errorHandler = fn;
  }

  /** Create / resume the AudioContext. Call from a user gesture (iOS autoplay rules). */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0;
      this.samples = new Float32Array(this.analyser.fftSize);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state !== "running") void this.ctx.resume();
    // A one-sample silent buffer started inside the gesture fully unlocks iOS Safari.
    const silent = this.ctx.createBuffer(1, 1, 22050);
    const src = this.ctx.createBufferSource();
    src.buffer = silent;
    src.connect(this.ctx.destination);
    src.start();
  }

  get speaking() {
    return this.sources.size > 0;
  }

  onSpeakingChange(fn: (speaking: boolean) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn(this.speaking);
  }

  private async slot() {
    if (this.inFlight < MAX_IN_FLIGHT) {
      this.inFlight++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.inFlight++;
  }

  private release() {
    this.inFlight--;
    this.waiting.shift()?.();
  }

  private async fetchClip(text: string, previous: string, gen: number): Promise<AudioBuffer | null> {
    await this.slot();
    if (gen !== this.generation || !this.ctx) {
      this.release();
      return null;
    }
    const abort = new AbortController();
    this.aborts.add(abort);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, previous_text: previous || undefined }),
        signal: abort.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new TtsError(body?.error ?? `Voice request failed (${res.status})`);
      }
      const data = await res.arrayBuffer();
      if (gen !== this.generation) return null;
      return await this.ctx.decodeAudioData(data);
    } finally {
      this.aborts.delete(abort);
      this.release();
    }
  }

  /** Queue a sentence. Fetching starts right away (up to 2 at once); playback stays in order. */
  enqueue(text: string) {
    if (!this.ctx) return;
    const gen = this.generation;
    const clip = this.fetchClip(text, this.previousText, gen);
    this.previousText = text;
    clip.catch(() => {}); // handled in the chain below
    this.chain = this.chain.then(async () => {
      let buffer: AudioBuffer | null = null;
      try {
        buffer = await clip;
      } catch (err) {
        if (gen === this.generation && (err as Error).name !== "AbortError") {
          this.stop();
          this.errorHandler(err as Error);
        }
        return;
      }
      if (buffer && gen === this.generation) this.schedule(buffer);
    });
  }

  private schedule(buffer: AudioBuffer) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.analyser!);
    const start = Math.max(ctx.currentTime + 0.03, this.nextStart);
    src.start(start);
    this.nextStart = start + buffer.duration;
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      if (!this.sources.size) this.notify();
    };
    if (this.sources.size === 1) this.notify();
  }

  /** Silence immediately and drop everything queued or in flight. */
  stop() {
    this.generation++;
    for (const a of this.aborts) a.abort();
    this.aborts.clear();
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    const wasSpeaking = this.sources.size > 0;
    this.sources.clear();
    this.nextStart = 0;
    this.previousText = "";
    this.chain = Promise.resolve();
    if (wasSpeaking) this.notify();
  }

  /** Current speech amplitude, 0..1 (no allocation; safe to call every frame). */
  level(): number {
    if (!this.analyser || !this.samples || !this.sources.size) return 0;
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (let i = 0; i < this.samples.length; i++) sum += this.samples[i] * this.samples[i];
    const rms = Math.sqrt(sum / this.samples.length);
    return Math.min(1, rms * 4.5);
  }
}

export const voicePlayer = new VoicePlayer();
