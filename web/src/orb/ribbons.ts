import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  ShaderMaterial,
  Uint32BufferAttribute,
  Vector3,
} from "three";
import { layerUniforms } from "./drive";
import { glslCommon, glslDesat, glslDriveUniforms } from "./glsl";

/**
 * Thin glowing curves (rings, arcs, meridians, spirals) drawn as crossed ribbon pairs so
 * they read as lines from every angle. All curves in a layer share one draw call; each
 * curve spins about its own axis in the vertex shader.
 */
export interface RibbonCurve {
  points: Vector3[];
  /** Normal of the plane the curve (mostly) lies in; orients the ribbons. */
  planeNormal: Vector3;
  width: number;
  /** Optional width profile along the curve, u in [0, 1]. */
  widthAt?: (u: number) => number;
  spinAxis: Vector3;
  /** Radians per unit of spin clock (signed). */
  spinSpeed: number;
  /** Number of dashes along the curve; 0 = solid. */
  dashes?: number;
  /** Lit fraction of each dash period. */
  dashDuty?: number;
  intensity: number;
  /** 0 = mid orange, 1 = core gold, >1 leans toward highlight. */
  tone: number;
  /** 0..1 strength of a bright glint that travels along the curve. */
  glint?: number;
  seed: number;
}

export function circleArc(
  center: Vector3,
  normal: Vector3,
  radius: number,
  start: number,
  length: number,
  segmentsPerRadian = 40,
): Vector3[] {
  const e1 = new Vector3();
  const ref = Math.abs(normal.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  e1.crossVectors(normal, ref).normalize();
  const e2 = new Vector3().crossVectors(normal, e1).normalize();
  const n = Math.max(2, Math.ceil(length * segmentsPerRadian) + 1);
  const pts: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = start + (length * i) / (n - 1);
    pts.push(
      center
        .clone()
        .addScaledVector(e1, Math.cos(a) * radius)
        .addScaledVector(e2, Math.sin(a) * radius),
    );
  }
  return pts;
}

export function buildRibbonGeometry(curves: RibbonCurve[]): BufferGeometry {
  const position: number[] = [];
  const across: number[] = [];
  const along: number[] = [];
  const spinAxis: number[] = [];
  const spin: number[] = [];
  const style: number[] = [];
  const seed: number[] = [];
  const index: number[] = [];

  const tangent = new Vector3();
  const n1 = new Vector3();
  const n2 = new Vector3();
  const v = new Vector3();

  for (const c of curves) {
    const pts = c.points;
    const count = pts.length;
    const base = position.length / 3;
    for (let i = 0; i < count; i++) {
      const u = i / (count - 1);
      tangent.subVectors(pts[Math.min(i + 1, count - 1)], pts[Math.max(i - 1, 0)]).normalize();
      n1.crossVectors(tangent, c.planeNormal);
      if (n1.lengthSq() < 1e-8) n1.crossVectors(tangent, new Vector3(0, 1, 0));
      n1.normalize();
      n2.crossVectors(n1, tangent).normalize();
      const w = c.width * (c.widthAt ? c.widthAt(u) : 1);
      for (const [dir, s] of [
        [n1, -1],
        [n1, 1],
        [n2, -1],
        [n2, 1],
      ] as const) {
        v.copy(pts[i]).addScaledVector(dir, w * s);
        position.push(v.x, v.y, v.z);
        across.push(s);
        along.push(u);
        spinAxis.push(c.spinAxis.x, c.spinAxis.y, c.spinAxis.z);
        spin.push(c.spinSpeed);
        style.push(c.dashes ?? 0, c.dashDuty ?? 0.5, c.intensity, c.tone);
        seed.push(c.seed, c.glint ?? 0);
      }
      if (i < count - 1) {
        const a = base + i * 4;
        const b = a + 4;
        // Ribbon 1 (verts 0,1) and ribbon 2 (verts 2,3).
        index.push(a, b, a + 1, a + 1, b, b + 1);
        index.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
      }
    }
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(position, 3));
  g.setAttribute("aAcross", new Float32BufferAttribute(across, 1));
  g.setAttribute("aU", new Float32BufferAttribute(along, 1));
  g.setAttribute("aSpinAxis", new Float32BufferAttribute(spinAxis, 3));
  g.setAttribute("aSpin", new Float32BufferAttribute(spin, 1));
  g.setAttribute("aStyle", new Float32BufferAttribute(style, 4));
  g.setAttribute("aSeed", new Float32BufferAttribute(seed, 2));
  g.setIndex(new Uint32BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

const vertexShader = /* glsl */ `
${glslDriveUniforms}
${glslCommon}
uniform float uSpreadWeight;
attribute float aAcross;
attribute float aU;
attribute vec3 aSpinAxis;
attribute float aSpin;
attribute vec4 aStyle;
attribute vec2 aSeed;
varying float vAcross;
varying float vU;
varying vec4 vStyle;
varying vec2 vSeed;

void main() {
  vAcross = aAcross;
  vU = aU;
  vStyle = aStyle;
  vSeed = aSeed;
  vec3 p = rotateAxis(position, aSpinAxis, uSpin * aSpin);
  p *= mix(1.0, uSpread, uSpreadWeight);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const fragmentShader = /* glsl */ `
${glslDriveUniforms}
${glslCommon}
${glslDesat}
uniform float uGain;
varying float vAcross;
varying float vU;
varying vec4 vStyle;
varying vec2 vSeed;

void main() {
  // Soft falloff across the ribbon: the bright spine, anti-aliased edges.
  // (Clamped: with MSAA, varyings are extrapolated outside sub-pixel-thin triangles.)
  float across = min(abs(vAcross), 1.0);
  float edge = 1.0 - across * across;
  edge *= edge;
  float u = clamp(vU, 0.0, 1.0);

  float dash = 1.0;
  if (vStyle.x > 0.0) {
    float f = fract(u * vStyle.x);
    float aa = min(0.2, 0.6 / max(vStyle.x, 1.0));
    dash = smoothstep(0.0, aa, f) * (1.0 - smoothstep(vStyle.y - aa, vStyle.y, f));
  }
  float ends = smoothstep(0.0, 0.02, u) * (1.0 - smoothstep(0.98, 1.0, u));

  // Rare whole-curve flickers.
  float h = hash11(floor(uTime * 5.0) + vSeed.x * 97.0);
  float flick = 1.0 + step(0.993, h) * 0.8 * uFlicker;

  // A bright glint sliding along some curves.
  float gp = fract(uTime * (0.03 + 0.05 * fract(vSeed.x * 13.7)) + vSeed.x * 7.0);
  float gd = u - gp;
  float glint = vSeed.y * exp(-gd * gd * 1800.0);

  vec3 base = vStyle.w <= 1.0
    ? mix(uColMid, uColCore, vStyle.w)
    : mix(uColCore, uColHi, vStyle.w - 1.0);
  vec3 col = base * vStyle.z * flick + uColHot * glint * 1.1;
  col *= uBrightness * uGain * edge * dash * ends;
  gl_FragColor = vec4(desat(col, uDesat * 0.6), 1.0);
}
`;

export function createRibbonMaterial(options: { core?: boolean; gain?: number; spreadWeight?: number } = {}) {
  return new ShaderMaterial({
    uniforms: {
      ...layerUniforms({ core: options.core }),
      uGain: { value: options.gain ?? 1 },
      uSpreadWeight: { value: options.spreadWeight ?? 1 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}
