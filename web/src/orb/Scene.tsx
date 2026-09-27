import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useState } from "react";
import { MathUtils } from "three";
import { debug } from "../debug";
import { Background } from "./Background";
import { Orb } from "./Orb";
import { PerfGovernor } from "./perf";
import { PostFX } from "./PostFX";

const FOV = 35;
/** Visual diameter of the orb including the outer streak shell. */
const ORB_DIAMETER = 2.15;

/** Keeps the orb at ~66% of viewport height on wide screens and ~80% of width on phones. */
function CameraRig() {
  const camera = useThree((s) => s.camera);
  const { width, height } = useThree((s) => s.size);
  useEffect(() => {
    const aspect = width / Math.max(height, 1);
    const visibleHeight = Math.max(ORB_DIAMETER / 0.66, ORB_DIAMETER / (0.8 * aspect));
    camera.position.set(0, 0, visibleHeight / 2 / Math.tan(MathUtils.degToRad(FOV / 2)));
    camera.lookAt(0, 0, 0);
  }, [camera, width, height]);
  return null;
}

function SceneContents() {
  const { width, height } = useThree((s) => s.size);
  return (
    <>
      <Background aspect={width / Math.max(height, 1)} />
      <CameraRig />
      <Orb />
      {debug.postFx && <PostFX />}
      <PerfGovernor />
    </>
  );
}

function usePageVisible() {
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

export function Scene() {
  const visible = usePageVisible();
  return (
    <Canvas
      className="stage"
      flat
      dpr={[1, 2]}
      frameloop={visible ? "always" : "never"}
      camera={{ fov: FOV, near: 0.1, far: 50, position: [0, 0, 5] }}
      gl={{ antialias: false, alpha: false, powerPreference: "high-performance", stencil: false }}
    >
      <SceneContents />
    </Canvas>
  );
}
