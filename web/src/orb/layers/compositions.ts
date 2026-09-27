import { Vector3 } from "three";
import { createRng, perpendicular } from "../random";
import { circleArc, type RibbonCurve } from "../ribbons";

const DEG = Math.PI / 180;
const ORIGIN = new Vector3();

/** Layer 1: outer shell of broken rings on independently tilted axes. */
export function buildShell(): RibbonCurve[] {
  const rng = createRng(1107);
  const curves: RibbonCurve[] = [];
  const RINGS = 34;
  for (let i = 0; i < RINGS; i++) {
    const normal = rng.unitVector();
    const radius = rng.range(0.9, 1.0);
    const length = rng.range(20, 300) * DEG;
    const start = rng.range(0, Math.PI * 2);
    const kind = rng.next();
    // Mostly hairlines, some medium strokes, a few wide dim bands.
    const width = kind < 0.68 ? rng.range(0.0022, 0.0036) : kind < 0.9 ? rng.range(0.0045, 0.0065) : rng.range(0.012, 0.02);
    const intensity = kind < 0.9 ? rng.range(0.45, 1.0) : rng.range(0.12, 0.22);
    const dashRoll = rng.next();
    const dashes = dashRoll < 0.18 ? rng.range(18, 60) : dashRoll < 0.3 ? rng.range(140, 260) : 0;
    // Spin axis slightly off the ring normal, so planes slowly precess rather than sit still.
    const spinAxis = rng.next() < 0.6 ? rng.jitter(normal, 0.18) : normal.clone();
    const spinSpeed = rng.sign() * rng.range(0.02, 0.08);
    const base: RibbonCurve = {
      points: circleArc(ORIGIN, normal, radius, start, length),
      planeNormal: normal,
      width,
      spinAxis,
      spinSpeed,
      dashes: Math.round(dashes * (length / (Math.PI * 2))) || (dashes ? 1 : 0),
      dashDuty: rng.range(0.35, 0.7),
      intensity,
      tone: rng.range(0.2, 1.15),
      glint: rng.next() < 0.35 ? rng.range(0.5, 1) : 0,
      seed: rng.next(),
    };
    curves.push(base);
    // Some rings carry a close parallel companion, like a double-ruled track.
    if (kind < 0.9 && rng.next() < 0.28) {
      const offset = rng.range(0.012, 0.022) * rng.sign();
      curves.push({
        ...base,
        points: circleArc(ORIGIN, normal, radius + offset, start + rng.range(-0.2, 0.2), length * rng.range(0.4, 1)),
        width: 0.0022,
        dashes: 0,
        intensity: intensity * 0.55,
        glint: 0,
        seed: rng.next(),
      });
    }
  }
  return curves;
}

/** Layer 3: sparse latitude / longitude fragments that give the sphere volume. */
export function buildGlobe(): RibbonCurve[] {
  const rng = createRng(2203);
  const curves: RibbonCurve[] = [];
  const R = 0.93;
  const axis = new Vector3(0.28, 1, 0.12).normalize();
  const spinSpeed = 0.028;
  const e1 = perpendicular(axis);
  const e2 = new Vector3().crossVectors(axis, e1);

  // Meridians: half great circles through the poles, each only partially drawn.
  for (let lon = 0; lon < 360; lon += 15) {
    if (rng.next() < 0.42) continue;
    const d = e1.clone().multiplyScalar(Math.cos(lon * DEG)).addScaledVector(e2, Math.sin(lon * DEG));
    const planeNormal = new Vector3().crossVectors(d, axis).normalize();
    const from = rng.range(-80, 30) * DEG;
    const to = Math.min(from + rng.range(25, 110) * DEG, 82 * DEG);
    const pts: Vector3[] = [];
    const n = Math.ceil((to - from) * 40) + 1;
    for (let i = 0; i < n; i++) {
      const phi = from + ((to - from) * i) / (n - 1);
      pts.push(d.clone().multiplyScalar(Math.cos(phi) * R).addScaledVector(axis, Math.sin(phi) * R));
    }
    curves.push({
      points: pts,
      planeNormal,
      width: 0.0018,
      spinAxis: axis,
      spinSpeed,
      dashes: rng.next() < 0.3 ? Math.round(rng.range(30, 70)) : 0,
      dashDuty: 0.5,
      intensity: rng.range(0.18, 0.34),
      tone: 0.5,
      seed: rng.next(),
    });
  }

  // Latitude arcs.
  for (const lat of [-72, -55, -35, -15, 15, 35, 55, 72]) {
    const pieces = rng.next() < 0.5 ? 1 : 2;
    for (let p = 0; p < pieces; p++) {
      const center = axis.clone().multiplyScalar(Math.sin(lat * DEG) * R);
      curves.push({
        points: circleArc(center, axis, Math.cos(lat * DEG) * R, rng.range(0, Math.PI * 2), rng.range(40, 170) * DEG),
        planeNormal: axis,
        width: 0.0018,
        spinAxis: axis,
        spinSpeed,
        dashes: rng.next() < 0.35 ? Math.round(rng.range(40, 90)) : 0,
        dashDuty: 0.45,
        intensity: rng.range(0.16, 0.3),
        tone: 0.5,
        seed: rng.next(),
      });
    }
  }
  return curves;
}

/** Layer 5: fast inner swirl — spiral arcs plus small bright rings. */
export function buildCore(): RibbonCurve[] {
  const rng = createRng(3301);
  const curves: RibbonCurve[] = [];
  const SPIRALS = 3;
  const swirlAxis = new Vector3(0.15, 1, 0.35).normalize();
  for (let s = 0; s < SPIRALS; s++) {
    const normal = rng.jitter(swirlAxis, 0.5);
    const e1 = perpendicular(normal);
    const e2 = new Vector3().crossVectors(normal, e1);
    const turns = rng.range(1.1, 1.7);
    const theta0 = (s / SPIRALS) * Math.PI * 2;
    const pts: Vector3[] = [];
    const n = 220;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const r = 0.045 + 0.29 * Math.pow(t, 1.15);
      const a = theta0 + t * turns * Math.PI * 2;
      const lift = 0.035 * Math.sin(t * Math.PI * 3 + s);
      pts.push(
        e1.clone().multiplyScalar(Math.cos(a) * r).addScaledVector(e2, Math.sin(a) * r).addScaledVector(normal, lift),
      );
    }
    curves.push({
      points: pts,
      planeNormal: normal,
      width: 0.006,
      widthAt: (u) => 0.35 + 0.65 * Math.sin(Math.min(u * 1.4, 1) * Math.PI * 0.5),
      spinAxis: normal,
      spinSpeed: rng.range(0.28, 0.4),
      intensity: rng.range(0.8, 1.0),
      tone: 1.35,
      glint: 1,
      seed: rng.next(),
    });
  }
  for (let i = 0; i < 6; i++) {
    const normal = rng.jitter(swirlAxis, 0.9);
    curves.push({
      points: circleArc(ORIGIN, normal, rng.range(0.14, 0.27), rng.range(0, Math.PI * 2), rng.range(60, 260) * DEG),
      planeNormal: normal,
      width: rng.range(0.0025, 0.0045),
      spinAxis: normal,
      spinSpeed: rng.sign() * rng.range(0.2, 0.45),
      dashes: rng.next() < 0.3 ? Math.round(rng.range(16, 40)) : 0,
      dashDuty: 0.55,
      intensity: rng.range(0.6, 1.0),
      tone: rng.range(1, 1.5),
      glint: rng.next() < 0.5 ? 1 : 0,
      seed: rng.next(),
    });
  }
  return curves;
}
