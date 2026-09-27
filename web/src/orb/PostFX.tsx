import { Bloom, ChromaticAberration, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useMemo } from "react";
import { Vector2 } from "three";
import { GrainScanEffect } from "./GrainScanEffect";

/** Layer 8: bloom does the glow; slight edge chromatic aberration; grain; vignette. */
export function PostFX() {
  const grain = useMemo(() => new GrainScanEffect(), []);
  const caOffset = useMemo(() => new Vector2(0.0011, 0.0006), []);
  return (
    <EffectComposer multisampling={4}>
      <Bloom mipmapBlur intensity={1.7} radius={0.55} luminanceThreshold={0.14} luminanceSmoothing={0.35} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <ChromaticAberration offset={caOffset} radialModulation modulationOffset={0.35} />
      <primitive object={grain} dispose={null} />
      <Vignette offset={0.28} darkness={0.72} />
    </EffectComposer>
  );
}
