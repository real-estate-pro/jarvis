import { useEffect, useMemo } from "react";
import { AdditiveBlending, PlaneGeometry, ShaderMaterial } from "three";
import { layerUniforms } from "../drive";
import { glslCommon, glslDesat, glslDriveUniforms } from "../glsl";

const vertexShader = /* glsl */ `
uniform float uSize;
uniform float uEnergy;
varying vec2 vUv;
void main() {
  vUv = position.xy * 2.0;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize * (1.0 + 0.25 * uEnergy);
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
${glslDriveUniforms}
${glslCommon}
${glslDesat}
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float pulse = 0.9 + 0.1 * sin(uTime * 1.3) + 0.6 * uEnergy;
  float halo = exp(-r * r * 12.0) * 0.25;
  float body = exp(-r * r * 70.0) * 0.8;
  float spark = exp(-r * r * 500.0) * 1.5;
  vec3 col = uColMid * halo + uColCore * body + uColHot * spark;
  col *= pulse * uBrightness * smoothstep(1.0, 0.7, r);
  gl_FragColor = vec4(desat(col, uDesat * 0.6), 1.0);
}
`;

/** Soft glowing nucleus at the heart of the core. Billboarded. */
export function Nucleus({ size = 0.55 }: { size?: number }) {
  const geometry = useMemo(() => new PlaneGeometry(1, 1), []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { ...layerUniforms(), uSize: { value: size } },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
      }),
    [size],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}
