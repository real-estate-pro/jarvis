import { useEffect, useMemo } from "react";
import { BufferGeometry, Float32BufferAttribute, ShaderMaterial } from "three";
import { palette } from "./palette";

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uInner;
uniform vec3 uOuter;
uniform float uAspect;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(p);
  vec3 col = mix(uInner, uOuter, smoothstep(0.0, 0.9, r));
  // A faint cool haze sitting behind the orb.
  col += uInner * 0.35 * exp(-r * r * 6.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Near-black, faintly blue-steel backdrop. A single full-screen triangle drawn first. */
export function Background({ aspect }: { aspect: number }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    return g;
  }, []);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uInner: { value: palette.bgInner },
          uOuter: { value: palette.bgOuter },
          uAspect: { value: 1 },
        },
        vertexShader,
        fragmentShader,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  material.uniforms.uAspect.value = aspect;
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={-100} />;
}
