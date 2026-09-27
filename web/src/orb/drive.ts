import type { IUniform } from "three";
import { palette } from "./palette";

/**
 * One mutable "drive" feeds every orb layer. States set targets; each frame the current
 * values ease toward them (frame-rate independent), and rotation is integrated from speed
 * rather than computed from absolute time, so speed changes never make anything jump.
 */
export type OrbMode = "idle" | "attentive" | "thinking" | "responding" | "speaking" | "error";

export interface DriveParams {
  /** Rotation speed multiplier for the shell, bands, globe and streaks. */
  spin: number;
  /** Rotation speed multiplier for the inner core. */
  coreSpin: number;
  /** Overall brightness multiplier. */
  brightness: number;
  /** Segment flicker amount. */
  flicker: number;
  /** Radius multiplier for rings and streaks (contract < 1 < expand). */
  spread: number;
  /** Baseline 0..1 intensity; pulses and audio add on top. */
  energy: number;
  /** 0..1 pull toward grey (error state). */
  desat: number;
  /** Breathing amplitude (fraction of scale). */
  breath: number;
  /** Visibility of the scanning sweep arc. */
  sweep: number;
  /** Sweep arc speed, rad/s. */
  sweepSpeed: number;
  /** Small positional jitter amplitude (error state). */
  jitter: number;
}

const IDLE: DriveParams = {
  spin: 1,
  coreSpin: 1,
  brightness: 1,
  flicker: 1,
  spread: 1,
  energy: 0,
  desat: 0,
  breath: 0.015,
  sweep: 0,
  sweepSpeed: 0.3,
  jitter: 0,
};

const PRESETS: Record<OrbMode, DriveParams> = {
  idle: IDLE,
  attentive: { ...IDLE, brightness: 1.15, spread: 0.965, sweep: 1, sweepSpeed: 0.45 },
  thinking: { ...IDLE, spin: 2.6, coreSpin: 3.5, brightness: 1.12, flicker: 2.2, energy: 0.3, sweep: 1, sweepSpeed: 1.6, breath: 0.02 },
  responding: { ...IDLE, spin: 1.6, coreSpin: 2, brightness: 1.1, flicker: 1.4, energy: 0.1, sweep: 0.35, sweepSpeed: 0.8 },
  speaking: { ...IDLE, spin: 1.4, coreSpin: 1.8, brightness: 1.08, flicker: 1.2, sweep: 0.25, sweepSpeed: 0.6 },
  error: { ...IDLE, spin: 0.7, brightness: 0.8, desat: 0.75, jitter: 1 },
};

/** Seconds for the eased values to cover ~63% of the distance; ~3x this to settle (~600 ms). */
const EASE_TAU = 0.2;
const BREATH_PERIOD = 6;
/** Pulse / audio envelope smoothing (spec: ~80 ms attack, ~250 ms release). */
const LEVEL_ATTACK = 0.08;
const LEVEL_RELEASE = 0.25;
/** Text pulses decay on their own so the orb "talks" in rhythm with the stream. */
const PULSE_DECAY = 0.22;
const PING_DURATION = 1.1;

const u = (value: number): IUniform<number> => ({ value });

export const uniforms = {
  uTime: u(0),
  uSpin: u(0),
  uCoreSpin: u(0),
  uEnergy: u(0),
  uBrightness: u(1),
  uFlicker: u(1),
  uSpread: u(1),
  uDesat: u(0),
  uSweep: u(0),
  uSweepHead: u(0),
  /** Seconds since the last tool ping, normalized 0..1; >= 1 means inactive. */
  uPing: u(1),
  uColCore: { value: palette.core },
  uColMid: { value: palette.mid },
  uColHi: { value: palette.highlight },
  uColHot: { value: palette.hot },
};

/** Uniforms for a layer material. `core` layers rotate on the faster core clock. */
export function layerUniforms(options: { core?: boolean } = {}) {
  const { uCoreSpin, ...rest } = uniforms;
  return { ...rest, uSpin: options.core ? uCoreSpin : uniforms.uSpin };
}

const reducedMotionQuery =
  typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

export const drive = {
  mode: "idle" as OrbMode,
  target: { ...IDLE },
  current: { ...IDLE },
  reducedMotion: reducedMotionQuery?.matches ?? false,
  /** Current breathing scale factor, read by the orb root each frame. */
  scale: 1,
  /** Current jitter offset, read by the orb root each frame. */
  offset: { x: 0, y: 0 },
  time: 0,

  /** Decaying text-pulse envelope (0..1). */
  pulseLevel: 0,
  /** Live external level, e.g. audio amplitude (0..1); set every frame by the voice layer. */
  inputLevel: 0,
  /** Smoothed sum of pulse + input, with attack/release. */
  level: 0,
  pingAge: PING_DURATION,

  setMode(mode: OrbMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    Object.assign(this.target, PRESETS[mode]);
  },

  /** Kick the energy envelope (e.g. per streamed text chunk). */
  pulse(amount: number) {
    this.pulseLevel = Math.min(1, this.pulseLevel + amount);
  },

  /** Radial shockwave (tool started). */
  ping() {
    this.pingAge = 0;
    this.pulse(0.35);
  },

  update(dt: number) {
    // Clamp so a long pause (hidden tab, debugger) resumes smoothly instead of lurching.
    dt = Math.min(dt, 0.1);
    this.time += dt;

    const k = 1 - Math.exp(-dt / EASE_TAU);
    const c = this.current;
    const t = this.target;
    for (const key in c) {
      const name = key as keyof DriveParams;
      c[name] += (t[name] - c[name]) * k;
    }

    this.pulseLevel *= Math.exp(-dt / PULSE_DECAY);
    const want = Math.min(1, this.pulseLevel + this.inputLevel);
    const tau = want > this.level ? LEVEL_ATTACK : LEVEL_RELEASE;
    this.level += (want - this.level) * (1 - Math.exp(-dt / tau));
    this.pingAge = Math.min(PING_DURATION, this.pingAge + dt);

    const calm = this.reducedMotion ? 0.35 : 1;
    const energy = Math.min(1, c.energy + this.level * calm);
    uniforms.uTime.value = this.time;
    uniforms.uSpin.value += dt * c.spin * calm;
    uniforms.uCoreSpin.value += dt * c.coreSpin * calm;
    uniforms.uEnergy.value = energy;
    uniforms.uBrightness.value = c.brightness * (1 + 0.18 * energy);
    uniforms.uFlicker.value = c.flicker * (this.reducedMotion ? 0.25 : 1);
    // Rings breathe outward with energy (speech peaks push them out).
    uniforms.uSpread.value = c.spread * (1 + 0.045 * this.level * calm);
    uniforms.uDesat.value = c.desat;
    uniforms.uSweep.value = c.sweep;
    uniforms.uSweepHead.value += dt * c.sweepSpeed * calm;
    uniforms.uPing.value = this.pingAge / PING_DURATION;

    this.scale = 1 + c.breath * calm * Math.sin((this.time / BREATH_PERIOD) * Math.PI * 2);
    // Small, smooth jitter (sum of fast sines, not random steps) for the error state.
    const j = c.jitter * 0.012 * calm;
    this.offset.x = j * (Math.sin(this.time * 37) + 0.5 * Math.sin(this.time * 59));
    this.offset.y = j * (Math.sin(this.time * 43 + 1) + 0.5 * Math.sin(this.time * 71));
  },
};

reducedMotionQuery?.addEventListener("change", (e) => {
  drive.reducedMotion = e.matches;
});
