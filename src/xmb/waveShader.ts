// A single WebGL program renders the background, deformable ribbons, and dust.
// The ribbon geometry is deformed per vertex so integrated GPUs do not calculate
// the expensive trigonometry independently for every pixel.
export const WAVE_VERTEX = `
precision highp float;
precision mediump int;
attribute vec2 aPosition;
uniform vec2 uResolution;
uniform float uTime;
uniform float uBoot;
uniform float uSwell;
uniform float uSwellPosition;
uniform float uLayer;
uniform int uPass;
varying vec2 vUv;
varying vec2 vRibbon;
varying float vSheen;
varying float vStar;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vUv = vec2(0.0);
  vRibbon = vec2(0.0);
  vSheen = 0.0;
  vStar = 0.0;
  if (uPass == 0) {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  } else if (uPass == 1) {
    float x = aPosition.x;
    float v = aPosition.y;
    float phase = 0.4 + uLayer * 2.15;
    float t = uTime * 0.075;
    float travelling = x * 4.1 - t + phase;
    float secondary = x * 8.0 - t * 0.39 + phase * 1.6;
    float twist = x * 3.8 - t * 0.72 + phase;
    float homeCentre = 0.505 + (uLayer - 1.0) * 0.045
      + 0.041 * sin(travelling) + 0.018 * sin(secondary)
      - (x - 0.5) * 0.037;
    float homeWidth = (0.035 + 0.07 * abs(sin(twist))) * (1.0 - uLayer * 0.12);
    float bootCentre = 0.36 - x * 0.065 + 0.012 * sin(x * 4.0 - t * 0.65);
    float bootEnvelope = pow(max(0.0, sin(clamp(x, 0.0, 1.0) * 3.14159)), 0.72);
    float bootWidth = 0.008 + 0.115 * bootEnvelope * (0.6 + 0.4 * abs(cos(twist)));
    float centre = mix(homeCentre, bootCentre, uBoot);
    float width = mix(homeWidth, bootWidth, uBoot);
    float fold = v * width * cos(twist) + sin(v * 2.7 + twist) * width * 0.38;
    float swellDistance = x - uSwellPosition;
    centre += uSwell * 0.018 * exp(-swellDistance * swellDistance * 32.0)
      * sin(swellDistance * 20.0 + phase);
    float y = centre + fold;
    float offset = (v * v - 1.0) * 0.008 * sin(twist);
    vRibbon = vec2(x, v);
    vSheen = pow(max(0.0, 0.5 + 0.5 * cos(v * 5.0 + twist * 1.4)), 5.0);
    gl_Position = vec4((x + offset) * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  } else {
    float x = fract(aPosition.x + uTime * 0.0012);
    float y = 0.29 + aPosition.y * 0.37
      + 0.011 * sin(uTime * 0.12 + aPosition.x * 29.0);
    vStar = (0.3 + 0.7 * abs(sin(uTime * 0.35 + aPosition.x * 77.0)))
      * mix(0.35, 1.0, smoothstep(0.28, 0.8, x));
    gl_PointSize = mix(1.0, 2.6, hash21(aPosition)) * clamp(uResolution.x / 1200.0, 0.8, 1.3);
    gl_Position = vec4(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  }
}
`;

export const WAVE_FRAGMENT = `
precision highp float;
precision mediump int;
uniform vec2 uResolution;
uniform float uTime;
uniform float uProgress;
uniform float uBoot;
uniform float uBrightness;
uniform float uExposure;
uniform float uLayer;
uniform int uPass;
uniform vec3 uPalette[4];
varying vec2 vUv;
varying vec2 vRibbon;
varying float vSheen;
varying float vStar;

void main() {
  if (uExposure <= 0.001) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  if (uPass == 0) {
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    vec2 aspect = vec2(uResolution.x / max(uResolution.y, 1.0), 1.0);
    vec3 home = mix(uPalette[0], uPalette[1], smoothstep(0.02, 0.97, uv.y));
    float homeLight = max(0.0, 1.0 - length((uv - vec2(0.78, 0.12)) * aspect) * 1.1);
    home += uPalette[3] * homeLight * homeLight * 0.14;
    home *= uBrightness;
    float purple = max(0.0, 1.0 - length((uv - vec2(0.34, 0.35)) * aspect) * 1.2);
    vec3 bootBackground = mix(vec3(0.005, 0.002, 0.011), vec3(0.165, 0.055, 0.24), purple * purple);
    vec3 color = mix(home, bootBackground, uBoot);
    float source = max(0.0, 1.0 - length((uv - vec2(0.0, 0.355)) * vec2(19.0, 24.0)));
    color += vec3(1.0, 0.82, 1.0) * source * source * uBoot
      * smoothstep(0.0, 0.04, uProgress) * (1.0 - smoothstep(0.14, 0.62, uProgress)) * 0.7;
    float vignette = max(0.0, 1.0 - length((uv - vec2(0.48, 0.42)) * aspect) * 0.7);
    color *= mix(0.6 + 0.4 * vignette, 0.38 + 0.62 * vignette, uBoot);
    gl_FragColor = vec4(clamp(color * uExposure, 0.0, 1.0), 1.0);
  } else if (uPass == 1) {
    float x = vRibbon.x;
    float v = abs(vRibbon.y);
    float edge = 1.0 - smoothstep(0.75, 1.0, v);
    float hem = smoothstep(0.72, 0.9, v) * (1.0 - smoothstep(0.94, 1.0, v));
    float fade = smoothstep(-0.1, 0.22, x) * (1.0 - smoothstep(0.82, 1.13, x));
    float reveal = (1.0 - smoothstep(uProgress - 0.07, uProgress + 0.02, x))
      * (1.0 - smoothstep(0.72, 1.0, x));
    float weight = uLayer < 0.5 ? 1.0 : (1.0 - uBoot) * (uLayer < 1.5 ? 0.68 : 0.48);
    float alpha = (edge * (0.045 + 0.1 * vSheen) + hem * 0.08)
      * mix(fade, reveal, uBoot) * weight * uExposure * mix(0.72, 1.8, uBoot);
    vec3 color = mix(uPalette[2], vec3(1.0, 0.84, 1.0), uBoot);
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  } else {
    float radius = length(gl_PointCoord - vec2(0.5));
    float point = 1.0 - smoothstep(0.1, 0.5, radius);
    float alpha = point * vStar * mix(0.035, 0.23, uBoot) * uExposure
      * mix(1.0, smoothstep(0.08, 0.85, uProgress), uBoot);
    gl_FragColor = vec4(0.84, 0.9, 1.0, alpha);
  }
}
`;
