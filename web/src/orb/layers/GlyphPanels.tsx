import { useEffect, useMemo } from "react";
import {
  AdditiveBlending,
  CanvasTexture,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearMipmapLinearFilter,
  ShaderMaterial,
} from "three";
import { layerUniforms } from "../drive";
import { glslCommon, glslDesat, glslDriveUniforms } from "../glsl";
import { createRng, type Rng } from "../random";

/**
 * Layer 6: small translucent readout panels (procedural micro text, bars, waveforms)
 * drifting around the orb's edge, fading in with a flicker and out again. The panel
 * designs live in one canvas atlas; which design shows where is chosen in the shader.
 */
const COLS = 4;
const ROWS = 8;
const CELL_W = 256;
const CELL_H = 128;

function drawAtlas(): HTMLCanvasElement {
  const rng = createRng(6607);
  const canvas = document.createElement("canvas");
  canvas.width = COLS * CELL_W;
  canvas.height = ROWS * CELL_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const hex = (n: number) =>
    Array.from({ length: n }, () => "0123456789ABCDEF"[Math.floor(rng.next() * 16)]).join("");
  const labels = ["SYS", "NET", "CORE", "MEM", "PWR", "SIG", "DAT", "ARC", "NODE", "SYNC", "LNK", "PROC"];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      ctx.save();
      ctx.translate(col * CELL_W, row * CELL_H);
      drawPanel(ctx, rng, hex, labels);
      ctx.restore();
    }
  }
  return canvas;
}

function drawPanel(ctx: CanvasRenderingContext2D, rng: Rng, hex: (n: number) => string, labels: string[]) {
  const W = CELL_W;
  const H = CELL_H;
  const pad = 10;

  // Faint glass fill and frame with corner brackets.
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(4, 4, W - 8, H - 8);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(4.5, 4.5, W - 9, H - 9);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 2;
  const k = 12;
  for (const [x, y, dx, dy] of [
    [4, 4, 1, 1],
    [W - 4, 4, -1, 1],
    [4, H - 4, 1, -1],
    [W - 4, H - 4, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x + dx * k, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * k);
    ctx.stroke();
  }

  // Header.
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "bold 13px monospace";
  ctx.textBaseline = "top";
  ctx.fillText(`${rng.pick(labels)}.${hex(2)} // ${hex(4)}`, pad, pad);
  ctx.fillRect(pad, pad + 18, W - pad * 2, 1);
  ctx.font = "10px monospace";
  ctx.fillText(`${Math.floor(rng.range(10, 99))}.${Math.floor(rng.range(100, 999))}`, W - pad - 48, pad + 2);

  const top = pad + 26;
  const kind = Math.floor(rng.next() * 5);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.5;

  if (kind === 0) {
    // Label + bar rows.
    for (let i = 0; i < 6; i++) {
      const y = top + i * 14;
      ctx.font = "9px monospace";
      ctx.fillText(`${rng.pick(labels)}${i}`, pad, y);
      const w = rng.range(0.15, 1) * (W - pad * 2 - 50);
      ctx.fillRect(pad + 44, y + 2, w, 5);
      ctx.fillRect(pad + 44 + w + 3, y + 2, 1, 5);
    }
  } else if (kind === 1) {
    // Hex dump.
    ctx.font = "9px monospace";
    for (let i = 0; i < 7; i++) {
      ctx.globalAlpha = rng.range(0.4, 1);
      ctx.fillText(`${hex(4)}  ${hex(8)} ${hex(8)} ${hex(4)}`, pad, top + i * 12);
    }
    ctx.globalAlpha = 1;
  } else if (kind === 2) {
    // Waveform with baseline ticks.
    const mid = top + 40;
    ctx.beginPath();
    const f1 = rng.range(0.03, 0.08);
    const f2 = rng.range(0.1, 0.25);
    for (let x = pad; x < W - pad; x += 2) {
      const y = mid + Math.sin(x * f1) * 18 * Math.sin(x * 0.01 + 1) + Math.sin(x * f2) * 6 * rng.next();
      if (x === pad) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (let x = pad; x < W - pad; x += 12) ctx.fillRect(x, H - pad - 12, 1, x % 48 === pad % 48 ? 7 : 3);
  } else if (kind === 3) {
    // Gauges.
    for (let i = 0; i < 3; i++) {
      const cx = pad + 36 + i * 78;
      const cy = top + 42;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(cx, cy, 26, Math.PI * 0.75, Math.PI * 2.25);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 26, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * rng.range(0.1, 0.95)));
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.font = "10px monospace";
      ctx.fillText(`${Math.floor(rng.range(10, 99))}`, cx - 7, cy - 6);
    }
  } else {
    // Cell matrix.
    const size = 7;
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 26; x++) {
        const r = rng.next();
        if (r < 0.45) continue;
        ctx.globalAlpha = r < 0.85 ? 0.3 : 1;
        ctx.fillRect(pad + x * (size + 2), top + y * (size + 2), size, size);
      }
    }
    ctx.globalAlpha = 1;
  }
}

const PANELS = 7;

function buildPanels(): InstancedBufferGeometry {
  const rng = createRng(6701);
  const g = new InstancedBufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  // Favor the left and upper sides; the conversation lives below / right.
  const anchors = [150, 195, 115, 40, 78, 235, 262];
  const slot = new Float32Array(PANELS * 4); // base angle, distance, depth, period
  const look = new Float32Array(PANELS * 4); // width, height, seed, unused
  for (let i = 0; i < PANELS; i++) {
    slot[i * 4] = (anchors[i % anchors.length] * Math.PI) / 180;
    slot[i * 4 + 1] = rng.range(1.18, 1.42);
    slot[i * 4 + 2] = rng.range(-0.25, 0.3);
    slot[i * 4 + 3] = rng.range(9, 16);
    const w = rng.range(0.22, 0.32);
    look[i * 4] = w;
    look[i * 4 + 1] = w / 2;
    look[i * 4 + 2] = rng.next();
  }
  g.setAttribute("iSlot", new InstancedBufferAttribute(slot, 4));
  g.setAttribute("iLook", new InstancedBufferAttribute(look, 4));
  g.instanceCount = PANELS;
  return g;
}

const vertexShader = /* glsl */ `
${glslDriveUniforms}
${glslCommon}
attribute vec4 iSlot;
attribute vec4 iLook;
varying vec2 vUv;
varying vec2 vLocal;
varying float vFade;
varying float vReveal;
varying float vSeed;

void main() {
  float seed = iLook.z;
  float period = iSlot.w;
  // Panels flicker faster when the orb is busier.
  float clock = uTime * (1.0 + uEnergy * 0.6) + seed * period;
  float cycle = floor(clock / period);
  float local = fract(clock / period);

  float h1 = hash11(cycle * 7.13 + seed * 91.7);
  float h2 = hash11(cycle * 3.37 + seed * 17.3);
  float angle = iSlot.x + (h1 - 0.5) * 0.45 + (local - 0.5) * 0.12;
  vec3 center = vec3(cos(angle) * iSlot.y, sin(angle) * iSlot.y * 0.92, iSlot.z);
  center.y += sin(uTime * 0.3 + seed * 6.0) * 0.015;

  float cell = floor(h2 * ${COLS * ROWS}.0);
  vec2 cellOrigin = vec2(mod(cell, ${COLS}.0), floor(cell / ${COLS}.0));
  vLocal = position.xy;
  vec2 q = position.xy * 0.5 + 0.5;
  // Canvas rows run top-down; the texture is flipped on upload.
  vUv = vec2((cellOrigin.x + q.x) / ${COLS}.0, 1.0 - (cellOrigin.y + 1.0 - q.y) / ${ROWS}.0);

  // Visible for the middle of each cycle; flickers on, eases off.
  float on = smoothstep(0.0, 0.12, local) * (1.0 - smoothstep(0.7, 0.85, local));
  float glitch = local < 0.12 ? step(0.4, hash11(floor(uTime * 24.0) + seed * 13.0)) : 1.0;
  vFade = on * glitch;
  vReveal = clamp(local / 0.14, 0.0, 1.0);
  vSeed = seed;

  vec4 mv = modelViewMatrix * vec4(center, 1.0);
  mv.xy += position.xy * iLook.xy * 0.5;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
${glslDriveUniforms}
${glslCommon}
${glslDesat}
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec2 vLocal;
varying float vFade;
varying float vReveal;
varying float vSeed;

void main() {
  float m = texture2D(uAtlas, vUv).r;
  // Top-to-bottom reveal while the panel boots.
  float row = 1.0 - (vLocal.y * 0.5 + 0.5);
  m *= step(row, vReveal * 1.05);
  // Thin scanning line inside the panel.
  float scan = exp(-pow((row - fract(uTime * 0.25 + vSeed)) * 40.0, 2.0)) * 0.25;
  vec3 col = mix(uColCore, uColHi, 0.35) * (m + scan * step(0.02, m + 0.03));
  // Panels only appear once the orb is awake (hidden on the dim lock screen).
  col *= vFade * 0.62 * uBrightness * smoothstep(0.45, 0.8, uBrightness);
  gl_FragColor = vec4(desat(col, uDesat * 0.6), 1.0);
}
`;

export function GlyphPanels() {
  const geometry = useMemo(buildPanels, []);
  const texture = useMemo(() => {
    const t = new CanvasTexture(drawAtlas());
    t.minFilter = LinearMipmapLinearFilter;
    t.anisotropy = 4;
    return t;
  }, []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { ...layerUniforms(), uAtlas: { value: texture } },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
      }),
    [texture],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />;
}
