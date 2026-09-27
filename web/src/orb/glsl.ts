/** Shared GLSL helpers, prepended to the orb's shaders. */
export const glslCommon = /* glsl */ `
vec3 rotateAxis(vec3 p, vec3 axis, float a) {
  float s = sin(a);
  float c = cos(a);
  return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
}

float hash11(float n) {
  return fract(sin(n * 127.1 + 311.7) * 43758.5453123);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
`;

/** Shared uniform declarations driven by drive.ts. */
export const glslDriveUniforms = /* glsl */ `
uniform float uTime;
uniform float uSpin;
uniform float uEnergy;
uniform float uBrightness;
uniform float uFlicker;
uniform float uSpread;
uniform float uDesat;
uniform vec3 uColCore;
uniform vec3 uColMid;
uniform vec3 uColHi;
uniform vec3 uColHot;
`;

/** Pulls the final color toward grey for the (still gold) error desaturation. */
export const glslDesat = /* glsl */ `
vec3 desat(vec3 c, float amount) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(c, vec3(l), amount);
}
`;
