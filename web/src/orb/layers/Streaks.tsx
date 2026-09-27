import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  AdditiveBlending,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  ShaderMaterial,
  Vector3,
} from "three";
import { useOrbStore } from "../../state/orbStore";
import { drive, layerUniforms } from "../drive";
import { glslCommon, glslDesat, glslDriveUniforms } from "../glsl";
import { createRng, perpendicular } from "../random";

/**
 * Layer 4: thousands of short light streaks orbiting on sphere shells. Each streak is a
 * small curved strip computed entirely in the vertex shader from its orbit parameters,
 * stretched along its direction of travel.
 */
export const MAX_STREAKS = 2600;
const SEGMENTS = 6;

function buildStreaks(): InstancedBufferGeometry {
  const rng = createRng(5501);
  const g = new InstancedBufferGeometry();

  // Base strip: SEGMENTS+1 rows of (left, right) along the trail, t=0 at the head.
  const t: number[] = [];
  const side: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    t.push(i / SEGMENTS, i / SEGMENTS);
    side.push(-1, 1);
    if (i < SEGMENTS) {
      const a = i * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  // Positions are computed in the shader; three still wants a position attribute.
  g.setAttribute("position", new Float32BufferAttribute(new Float32Array(t.length * 3), 3));
  g.setAttribute("aT", new Float32BufferAttribute(t, 1));
  g.setAttribute("aSide", new Float32BufferAttribute(side, 1));
  g.setIndex(index);

  const families = Array.from({ length: 6 }, () => ({
    axis: rng.unitVector(),
    dir: rng.sign(),
  }));

  const axis = new Float32Array(MAX_STREAKS * 3);
  const start = new Float32Array(MAX_STREAKS * 3);
  const orbit = new Float32Array(MAX_STREAKS * 4); // radius, speed, phase, length
  const look = new Float32Array(MAX_STREAKS * 2); // width, brightness
  const a = new Vector3();
  const s = new Vector3();
  for (let i = 0; i < MAX_STREAKS; i++) {
    const fam = rng.next() < 0.92 ? rng.pick(families) : null;
    if (fam) rng.jitter(fam.axis, 0.08, a);
    else rng.unitVector(a);
    perpendicular(a, s);
    a.toArray(axis, i * 3);
    s.toArray(start, i * 3);

    const shell = rng.next();
    const radius = shell < 0.55 ? rng.range(0.86, 1.05) : shell < 0.85 ? rng.range(0.6, 0.86) : rng.range(0.36, 0.6);
    const speed = (fam ? fam.dir : rng.sign()) * rng.range(0.1, 0.34);
    const length = Math.min(0.8, Math.abs(speed) * rng.range(1.0, 2.4));
    orbit[i * 4] = radius;
    orbit[i * 4 + 1] = speed;
    orbit[i * 4 + 2] = rng.range(0, Math.PI * 2);
    orbit[i * 4 + 3] = length;
    look[i * 2] = rng.range(0.0018, 0.0042);
    look[i * 2 + 1] = 0.25 + 0.75 * Math.pow(rng.next(), 2.2);
  }
  g.setAttribute("iAxis", new InstancedBufferAttribute(axis, 3));
  g.setAttribute("iStart", new InstancedBufferAttribute(start, 3));
  g.setAttribute("iOrbit", new InstancedBufferAttribute(orbit, 4));
  g.setAttribute("iLook", new InstancedBufferAttribute(look, 2));
  g.instanceCount = MAX_STREAKS;
  return g;
}

const vertexShader = /* glsl */ `
${glslDriveUniforms}
${glslCommon}
attribute float aT;
attribute float aSide;
attribute vec3 iAxis;
attribute vec3 iStart;
attribute vec4 iOrbit;
attribute vec2 iLook;
varying float vT;
varying float vSide;
varying float vBright;
varying float vDepth;

void main() {
  float radius = iOrbit.x;
  float speed = iOrbit.y;
  float len = iOrbit.w;
  float ang = iOrbit.z + uSpin * speed - aT * len * sign(speed);

  vec3 dir = rotateAxis(iStart, iAxis, ang);
  float r = radius * uSpread * (1.0 + uEnergy * 0.07 * iLook.y);
  vec3 p = dir * r;
  vec3 tangent = cross(iAxis, dir) * sign(speed);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 tv = normalize((modelViewMatrix * vec4(tangent, 0.0)).xyz);
  vec3 sideDir = normalize(cross(tv, normalize(-mv.xyz)));
  mv.xyz += sideDir * aSide * iLook.x * (1.0 - 0.75 * aT);

  float dz = mv.z - (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
  vDepth = 0.35 + 0.65 * smoothstep(-1.0, 1.0, dz);
  vT = aT;
  vSide = aSide;
  vBright = iLook.y;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
${glslDriveUniforms}
${glslDesat}
varying float vT;
varying float vSide;
varying float vBright;
varying float vDepth;

void main() {
  // Clamp: with MSAA, varyings can be extrapolated past the strip's edges.
  float side = min(abs(vSide), 1.0);
  float t = clamp(vT, 0.0, 1.0);
  float across = 1.0 - side * side;
  float trail = pow(1.0 - t, 1.6);
  float head = pow(1.0 - t, 8.0);
  vec3 col = mix(uColMid, uColCore, 0.6) * trail + uColHot * head * 1.4;
  col *= vBright * vDepth * across * uBrightness * 0.5 * (1.0 + 0.6 * uEnergy);
  gl_FragColor = vec4(desat(col, uDesat * 0.6), 1.0);
}
`;

export function Streaks() {
  const geometry = useMemo(buildStreaks, []);
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
      }),
    [],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame(() => {
    const n = Math.round(MAX_STREAKS * useOrbStore.getState().quality * (drive.reducedMotion ? 0.5 : 1));
    if (geometry.instanceCount !== n) geometry.instanceCount = n;
  });

  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}
