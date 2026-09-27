import { useEffect, useMemo } from "react";
import { AdditiveBlending, PlaneGeometry, ShaderMaterial } from "three";
import { layerUniforms } from "../drive";
import { glslDesat, glslDriveUniforms } from "../glsl";

/** Radial "ping" shockwave when a tool starts. Billboarded; driven by uPing (0..1 age). */
const SIZE = 4.2;

const vertexShader = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xy * ${SIZE.toFixed(1)};
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += vPos;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
${glslDriveUniforms}
${glslDesat}
uniform float uPing;
varying vec2 vPos;
void main() {
  if (uPing >= 1.0) discard;
  float t = uPing;
  float r = length(vPos);
  float eased = 1.0 - pow(1.0 - t, 3.0);
  float radius = mix(0.3, 1.9, eased);
  float width = 0.006 + 0.022 * t;
  float ring = exp(-pow((r - radius) / width, 2.0));
  // A softer echo just inside the front.
  float echo = exp(-pow((r - radius * 0.88) / (width * 2.5), 2.0)) * 0.18;
  float fade = pow(1.0 - t, 2.0);
  vec3 col = mix(uColHi, uColCore, t) * (ring + echo) * fade * 0.75;
  gl_FragColor = vec4(desat(col, uDesat * 0.6), 1.0);
}
`;

export function Ping() {
  const geometry = useMemo(() => new PlaneGeometry(1, 1), []);
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
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}
