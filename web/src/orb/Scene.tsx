import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { MathUtils, Vector3 } from "three";
import { useAuthStore } from "../auth/authStore";
import { debug } from "../debug";
import { useOrbStore } from "../state/orbStore";
import { Background } from "./Background";
import { Orb } from "./Orb";
import { PerfGovernor } from "./perf";
import { PostFX } from "./PostFX";

const FOV = 35;
/** Visual diameter of the orb including the outer streak shell. */
const ORB_DIAMETER = 2.15;

/**
 * Keeps the orb at ~66% of viewport height on wide screens and ~80% of width on phones.
 * Locked, it sits centered; unlocked, it glides aside to make room for the conversation
 * (left on desktop, up on phones). Must match the phone breakpoint in styles.css.
 */
function CameraRig() {
  const camera = useThree((s) => s.camera);
  const { width, height } = useThree((s) => s.size);
  const locked = useAuthStore((s) => s.status !== "unlocked" && s.status !== "welcome");
  const target = useRef(new Vector3());
  const placed = useRef(false);

  useEffect(() => {
    const aspect = width / Math.max(height, 1);
    const visibleHeight = Math.max(ORB_DIAMETER / 0.66, ORB_DIAMETER / (0.8 * aspect));
    const phone = width <= 760 || aspect <= 1;
    // Orb center as a fraction of the viewport (x from left, y from top).
    const [cx, cy] = phone ? [0.5, 0.33] : locked ? [0.5, 0.42] : [0.42, 0.46];
    const dx = (0.5 - cx) * visibleHeight * aspect;
    const dy = -(0.5 - cy) * visibleHeight;
    target.current.set(dx, dy, visibleHeight / 2 / Math.tan(MathUtils.degToRad(FOV / 2)));
    // Jump on first layout and on resize; glide when the lock state changes.
    if (!placed.current) {
      camera.position.copy(target.current);
      camera.lookAt(dx, dy, 0);
      placed.current = true;
    }
    useOrbStore.getState().setLayout({ x: cx * width, y: cy * height, radius: height / visibleHeight });
  }, [camera, width, height, locked]);

  useEffect(() => {
    placed.current = false;
  }, [width, height]);

  useFrame((_, dt) => {
    const k = 1 - Math.exp(-Math.min(dt, 0.1) / 0.45);
    camera.position.lerp(target.current, k);
    camera.lookAt(camera.position.x, camera.position.y, 0);
  });
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
