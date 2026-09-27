import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import { debug } from "../debug";
import { drive, uniforms } from "./drive";
import { RibbonLayer } from "./layers/RibbonLayer";
import { buildCore, buildGlobe, buildShell } from "./layers/compositions";
import { DataBands } from "./layers/DataBands";
import { GlyphPanels } from "./layers/GlyphPanels";
import { Nucleus } from "./layers/Nucleus";
import { Ping } from "./layers/Ping";
import { Streaks } from "./layers/Streaks";
import { Sweep } from "./layers/Sweep";

/** Advances the shared drive once per frame, before any layer reads it. */
function DriveTicker() {
  useFrame((_, dt) => drive.update(dt));
  return null;
}

export function Orb() {
  const root = useRef<Group>(null);
  const tumble = useRef<Group>(null);

  useFrame(() => {
    root.current!.scale.setScalar(drive.scale);
    root.current!.position.set(drive.offset.x, drive.offset.y, 0);
    // A slow whole-orb tumble on top of every layer's own rotation.
    const spin = uniforms.uSpin.value;
    tumble.current!.rotation.set(0.22 + 0.08 * Math.sin(drive.time * 0.05), spin * 0.035, 0.06 * Math.sin(drive.time * 0.037));
  });

  return (
    <>
      <DriveTicker />
      <group ref={root}>
        <group ref={tumble}>
          {debug.showLayer("globe") && <RibbonLayer build={buildGlobe} gain={1} spreadWeight={0.6} />}
          {debug.showLayer("bands") && <DataBands />}
          {debug.showLayer("shell") && <RibbonLayer build={buildShell} gain={1.1} />}
          {debug.showLayer("streaks") && <Streaks />}
          {debug.showLayer("core") && <RibbonLayer build={buildCore} core gain={0.9} spreadWeight={0.3} />}
          {debug.showLayer("core") && <Nucleus />}
        </group>
        {debug.showLayer("panels") && <GlyphPanels />}
        {debug.showLayer("sweep") && <Sweep />}
        <Ping />
      </group>
    </>
  );
}
