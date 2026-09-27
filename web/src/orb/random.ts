import { Vector3 } from "three";

/** Seeded PRNG (mulberry32) so the orb is composed identically on every load. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const range = (min: number, max: number) => min + (max - min) * next();
  const sign = () => (next() < 0.5 ? -1 : 1);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)];
  const unitVector = (out = new Vector3()) => {
    const z = range(-1, 1);
    const phi = range(0, Math.PI * 2);
    const r = Math.sqrt(1 - z * z);
    return out.set(r * Math.cos(phi), r * Math.sin(phi), z);
  };
  /** Unit vector within `spread` radians of `around`. */
  const jitter = (around: Vector3, spread: number, out = new Vector3()) =>
    out
      .copy(around)
      .addScaledVector(unitVector(), Math.tan(spread) * Math.sqrt(next()))
      .normalize();
  return { next, range, sign, pick, unitVector, jitter };
}

export type Rng = ReturnType<typeof createRng>;

/** Any unit vector perpendicular to `v`. */
export function perpendicular(v: Vector3, out = new Vector3()) {
  const ref = Math.abs(v.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  return out.crossVectors(v, ref).normalize();
}
