import { useEffect, useMemo } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  ShaderMaterial,
  Uint32BufferAttribute,
  Vector3,
} from "three";
import { layerUniforms } from "../drive";
import { glslCommon, glslDesat, glslDriveUniforms } from "../glsl";
import { createRng, perpendicular } from "../random";

/**
 * Layer 2: circuit-trace "data bands" — rings of tiny ticks, barcode runs and traces
 * wrapped around the sphere. Individual segments flicker brighter at random.
 */
function buildBands(): BufferGeometry {
  const rng = createRng(4409);
  const position: number[] = [];
  const local: number[] = [];
  const axisAttr: number[] = [];
  const spin: number[] = [];
  const data: number[] = []; // seed, theta, intensity, kind
  const index: number[] = [];

  const c = new Vector3();
  const t = new Vector3();
  const b = new Vector3();
  const out = new Vector3();
  const v = new Vector3();

  const BANDS = 9;
  const R = 0.82;
  for (let bi = 0; bi < BANDS; bi++) {
    const axis = rng.unitVector();
    const e1 = perpendicular(axis);
    const e2 = new Vector3().crossVectors(axis, e1);
    const h = rng.range(-0.38, 0.38) * R;
    const r = Math.sqrt(R * R - h * h) + rng.range(-0.03, 0.03);
    const speed = rng.sign() * rng.range(0.03, 0.07);

    const quad = (theta: number, along: number, across: number, lift: number, intensity: number, kind: number) => {
      c.copy(axis).multiplyScalar(h).addScaledVector(e1, Math.cos(theta) * r).addScaledVector(e2, Math.sin(theta) * r);
      t.copy(e1).multiplyScalar(-Math.sin(theta)).addScaledVector(e2, Math.cos(theta));
      out.copy(c).normalize();
      b.crossVectors(out, t).normalize();
      c.addScaledVector(b, lift);
      const base = position.length / 3;
      const seed = rng.next();
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        v.copy(c)
          .addScaledVector(t, (sx * along) / 2)
          .addScaledVector(b, (sy * across) / 2);
        position.push(v.x, v.y, v.z);
        local.push(sx, sy);
        axisAttr.push(axis.x, axis.y, axis.z);
        spin.push(speed);
        data.push(seed, theta, intensity, kind);
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    let theta = rng.range(0, Math.PI * 2);
    const end = theta + Math.PI * 2;
    while (theta < end) {
      const roll = rng.next();
      if (roll < 0.3) {
        theta += rng.range(0.06, 0.45); // gap
      } else if (roll < 0.72) {
        // Barcode / tick run.
        const count = Math.floor(rng.range(6, 34));
        const spacing = rng.range(0.011, 0.024);
        const uniform = rng.next() < 0.5;
        const height = rng.range(0.01, 0.028);
        const intensity = rng.range(0.35, 0.8);
        for (let k = 0; k < count && theta < end; k++) {
          const across = uniform ? height : rng.range(0.006, 0.034);
          quad(theta, spacing * r * rng.range(0.3, 0.55), across, 0, intensity, 0);
          theta += spacing;
        }
      } else {
        // Trace: long hairline with a pad at the end, sometimes offset off the band center.
        const len = rng.range(0.05, 0.3);
        const lift = rng.next() < 0.4 ? rng.range(-0.025, 0.025) : 0;
        const intensity = rng.range(0.45, 0.9);
        quad(theta + len / 2, len * r, 0.0028, lift, intensity, 1);
        quad(theta + len, 0.011, 0.011, lift, intensity, 2);
        theta += len + rng.range(0.02, 0.06);
      }
    }
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(position, 3));
  g.setAttribute("aLocal", new Float32BufferAttribute(local, 2));
  g.setAttribute("aAxis", new Float32BufferAttribute(axisAttr, 3));
  g.setAttribute("aSpin", new Float32BufferAttribute(spin, 1));
  g.setAttribute("aData", new Float32BufferAttribute(data, 4));
  g.setIndex(new Uint32BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

const vertexShader = /* glsl */ `
${glslDriveUniforms}
${glslCommon}
attribute vec2 aLocal;
attribute vec3 aAxis;
attribute float aSpin;
attribute vec4 aData;
varying vec2 vLocal;
varying vec4 vData;
void main() {
  vLocal = aLocal;
  vData = aData;
  vec3 p = rotateAxis(position, aAxis, uSpin * aSpin);
  p *= mix(1.0, uSpread, 0.7);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const fragmentShader = /* glsl */ `
${glslDriveUniforms}
${glslCommon}
${glslDesat}
varying vec2 vLocal;
varying vec4 vData;
void main() {
  float seed = vData.x;
  float theta = vData.y;
  float intensity = vData.z;
  float kind = vData.w;

  vec2 a = min(abs(vLocal), vec2(1.0)); // clamp MSAA extrapolation
  float soft = kind > 0.5 && kind < 1.5
    ? 1.0 - a.y * a.y // hairline trace: soft across only
    : (1.0 - smoothstep(0.55, 1.0, a.x)) * (1.0 - smoothstep(0.55, 1.0, a.y));

  // Data slowly "flowing" around the band.
  float flow = 0.55 + 0.45 * sin(theta * 3.0 - uTime * 0.7 + seed * 2.0);

  // Random segment flicker: each segment re-rolls at its own rate.
  float rate = 0.6 + seed * 2.2;
  float h = hash11(floor(uTime * rate + seed * 17.0) + seed * 531.0);
  float lit = step(0.955 - 0.03 * uEnergy, h) * uFlicker;

  vec3 col = mix(uColMid, uColCore, 0.35 + 0.5 * seed) * intensity * flow;
  col = mix(col, uColHot * 1.2, lit);
  col *= uBrightness * soft * 0.9;
  gl_FragColor = vec4(desat(col, uDesat * 0.6), 1.0);
}
`;

export function DataBands() {
  const geometry = useMemo(buildBands, []);
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
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}
