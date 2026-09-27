import type { IUniform } from "three";
import { palette } from "./palette";

/**
 * One mutable "drive" feeds every orb layer. States set targets; each frame the current
 * values ease toward them (frame-rate independent), and rotation is integrated from speed
 * rather than computed from absolute time, so speed changes never make anything jump.
 */
export type OrbMode = "idle";

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
  /** Generic 0..1 intensity used for pulses (text, audio). */
  energy: number;
  /** 0..1 pull toward grey (error state). */
  desat: number;
  /** Breathing amplitude (fraction of scale). */
  breath: number;
}

const PRESETS: Record<OrbMode, DriveParams> = {
  idle: { spin: 1, coreSpin: 1, brightness: 1, flicker: 1, spread: 1, energy: 0, desat: 0, breath: 0.015 },
};

/** Seconds for the eased values to cover ~63% of the distance; ~3x this to settle. */
const EASE_TAU = 0.2;
const BREATH_PERIOD = 6;

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
  target: { ...PRESETS.idle },
  current: { ...PRESETS.idle },
  reducedMotion: reducedMotionQuery?.matches ?? false,
  /** Current breathing scale factor, read by the orb root each frame. */
  scale: 1,
  time: 0,

  setMode(mode: OrbMode) {
    this.mode = mode;
    Object.assign(this.target, PRESETS[mode]);
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

    const calm = this.reducedMotion ? 0.35 : 1;
    uniforms.uTime.value = this.time;
    uniforms.uSpin.value += dt * c.spin * calm;
    uniforms.uCoreSpin.value += dt * c.coreSpin * calm;
    uniforms.uEnergy.value = c.energy;
    uniforms.uBrightness.value = c.brightness;
    uniforms.uFlicker.value = c.flicker * (this.reducedMotion ? 0.25 : 1);
    uniforms.uSpread.value = c.spread;
    uniforms.uDesat.value = c.desat;

    this.scale = 1 + c.breath * calm * Math.sin((this.time / BREATH_PERIOD) * Math.PI * 2);
  },
};

reducedMotionQuery?.addEventListener("change", (e) => {
  drive.reducedMotion = e.matches;
});
