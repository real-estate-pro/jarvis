import { BlendFunction, Effect } from "postprocessing";
import { Uniform } from "three";

const fragmentShader = /* glsl */ `
uniform float uGrain;
uniform float uScan;

float grainHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));

  // Fine horizontal scanlines plus a slow shimmer band drifting down the screen,
  // both only visible where there is light.
  float lines = sin(uv.y * resolution.y * 1.4) * 0.5;
  float band = exp(-pow((fract(uv.y + time * 0.035) - 0.5) * 7.0, 2.0));
  c *= 1.0 + uScan * lines + band * 0.06;

  // Film grain, scaled so the blacks stay black.
  float g = grainHash(uv * resolution + fract(time * 7.13) * 517.0) - 0.5;
  c += g * uGrain * (0.06 + lum);

  outputColor = vec4(max(c, 0.0), inputColor.a);
}
`;

/** Layer 7: very subtle film grain and horizontal scan shimmer. */
export class GrainScanEffect extends Effect {
  constructor({ grain = 0.05, scan = 0.05 } = {}) {
    super("GrainScanEffect", fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ["uGrain", new Uniform(grain)],
        ["uScan", new Uniform(scan)],
      ]),
    });
  }
}
