import { useEffect, useMemo } from "react";
import { AdditiveBlending, BufferGeometry, DoubleSide, Float32BufferAttribute, ShaderMaterial } from "three";
import { layerUniforms } from "../drive";
import { glslDesat, glslDriveUniforms } from "../glsl";

/**
 * Scanning sweep: a bright arc with a fading tail circling just outside the shell
 * (attentive and thinking states). Drawn in a gently tilted, mostly camera-facing plane.
 */
const RADIUS = 1.08;
const WIDTH = 0.006;
const SEGMENTS = 360;

function buildRing(): BufferGeometry {
  const position: number[] = [];
  const along: number[] = [];
  const across: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const u = i / SEGMENTS;
    const a = u * Math.PI * 2;
    for (const s of [-1, 1]) {
      const r = RADIUS + s * WIDTH;
      position.push(Math.cos(a) * r, Math.sin(a) * r, 0);
      along.push(u);
      across.push(s);
    }
    if (i < SEGMENTS) {
      const b = i * 2;
      index.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(position, 3));
  g.setAttribute("aU", new Float32BufferAttribute(along, 1));
  g.setAttribute("aAcross", new Float32BufferAttribute(across, 1));
  g.setIndex(index);
  return g;
}

const vertexShader = /* glsl */ `
uniform float uSpread;
attribute float aU;
attribute float aAcross;
varying float vU;
varying float vAcross;
void main() {
  vU = aU;
  vAcross = aAcross;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position * mix(1.0, uSpread, 0.5), 1.0);
}
`;

const fragmentShader = /* glsl */ `
${glslDriveUniforms}
${glslDesat}
uniform float uSweep;
uniform float uSweepHead;
varying float vU;
varying float vAcross;
void main() {
  float across = min(abs(vAcross), 1.0); // clamp MSAA extrapolation
  float edge = 1.0 - across * across;
  float head = fract(uSweepHead / 6.2831853);
  float d = fract(head - vU); // distance behind the head, 0..1 around the ring
  float trail = exp(-d * 7.0) * (1.0 - smoothstep(0.35, 0.5, d));
  float spark = exp(-d * 180.0);
  // A faint dashed track so the sweep reads as running on a rail.
  float track = 0.06 * step(0.5, fract(vU * 120.0));
  vec3 col = mix(uColMid, uColCore, 0.6) * (trail * 1.3 + track) + uColHot * spark * 1.6;
  col *= edge * uSweep * uBrightness;
  gl_FragColor = vec4(desat(col, uDesat * 0.6), 1.0);
}
`;

export function Sweep() {
  const geometry = useMemo(buildRing, []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: layerUniforms(),
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    [],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} rotation={[0.38, -0.2, 0]} frustumCulled={false} />;
}
