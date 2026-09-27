import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { useOrbStore } from "../state/orbStore";

/** Live frame stats, written every frame and read by the HUD a few times a second. */
export const perfStats = { fps: 0, frameMs: 0 };

const SLOW_FRAME_MS = 22;
const SLOW_FOR_S = 2;
const QUALITY_STEP = 0.7;
const MIN_QUALITY = 0.25;

/** Tracks frame time and steps render quality down when frames stay slow for 2s. */
export function PerfGovernor() {
  const slowFor = useRef(0);
  const settleFor = useRef(1); // ignore the first second (shader compile, warm-up)

  useFrame((_, dt) => {
    const ms = dt * 1000;
    perfStats.frameMs += (ms - perfStats.frameMs) * 0.1;
    perfStats.fps = perfStats.frameMs > 0 ? 1000 / perfStats.frameMs : 0;

    if (dt > 0.25) return; // tab switch or stall; not a sign of GPU load
    if (settleFor.current > 0) {
      settleFor.current -= dt;
      return;
    }
    slowFor.current = perfStats.frameMs > SLOW_FRAME_MS ? slowFor.current + dt : 0;
    if (slowFor.current >= SLOW_FOR_S) {
      slowFor.current = 0;
      settleFor.current = 1;
      const { quality, setQuality } = useOrbStore.getState();
      if (quality > MIN_QUALITY) setQuality(Math.max(MIN_QUALITY, quality * QUALITY_STEP));
    }
  });
  return null;
}
