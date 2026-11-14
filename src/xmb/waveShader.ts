// A single WebGL program renders the background, the deformable ribbons, and dust.
// The ribbons are evaluated analytically instead of through a folded mesh: a mesh
// produced hard cusps along its silhouette (visible stair-steps), while the
// analytic form stays smooth at any resolution. The ribbon shape is solved once
// per column on the vertex stage, so every pixel only pays for the shading.
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
varying float vStar;
varying float vCentre;
varying float vInvHalf;
varying float vHighlight;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vUv = vec2(0.0);
  vStar = 0.0;
  vCentre = 0.0;
  vInvHalf = 1.0;
  vHighlight = 0.0;
  if (uPass == 2) {
    float x = fract(aPosition.x + uTime * 0.0012);
    float y = 0.29 + aPosition.y * 0.37
      + 0.011 * sin(uTime * 0.12 + aPosition.x * 29.0);
    vStar = (0.3 + 0.7 * abs(sin(uTime * 0.35 + aPosition.x * 77.0)))
      * mix(0.35, 1.0, smoothstep(0.28, 0.8, x));
    gl_PointSize = mix(1.0, 2.6, hash21(aPosition)) * clamp(uResolution.x / 1200.0, 0.8, 1.7);
    gl_Position = vec4(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  } else if (uPass == 1) {
    float x = aPosition.x * 0.5 + 0.5;
    float layer = uLayer;
    float phase = 0.4 + layer * 2.15;
    float t = uTime * 0.075;
    float travelling = x * 4.1 - t + phase;
    float secondary = x * 8.0 - t * 0.39 + phase * 1.6;
    float twist = x * 3.8 - t * 0.72 + phase;
    float wave = 0.5 + 0.5 * sin(twist);

    float homeCentre = 0.505 + (layer - 1.0) * 0.045
      + 0.041 * sin(travelling) + 0.018 * sin(secondary) - (x - 0.5) * 0.037;
    float homeHalf = (0.030 + 0.082 * wave * wave) * (1.0 - layer * 0.10);

    float bootCentre = 0.36 - x * 0.065 + 0.012 * sin(x * 4.0 - t * 0.65);
    float bootHalf = 0.008 + 0.115 * sqrt(max(0.0, sin(clamp(x, 0.0, 1.0) * 3.14159)))
      * (0.6 + 0.4 * (0.5 + 0.5 * cos(twist * 2.0)));

    float centre = mix(homeCentre, bootCentre, uBoot);
    float halfWidth = max(mix(homeHalf, bootHalf, uBoot), 0.002);
    float swellDistance = x - uSwellPosition;
    centre += uSwell * 0.018 * exp(-swellDistance * swellDistance * 32.0)
      * sin(swellDistance * 20.0 + phase);

    vCentre = centre;
    vInvHalf = 1.0 / halfWidth;
    // A highlight rides inside the band and slides across it as the ribbon turns.
    vHighlight = 0.42 * sin(twist * 1.15 + 0.7);

    // The ribbon is drawn as a band that follows its own shape, so the
    // fragment stage only touches the pixels the ribbon can reach.
    float row = aPosition.y > 0.0 ? 0.0 : 1.0;
    float y = centre + (row * 2.0 - 1.0) * halfWidth * 1.14;
    vUv = vec2(x, y);
    gl_Position = vec4(aPosition.x, 1.0 - y * 2.0, 0.0, 1.0);
  } else {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
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
uniform vec3 uPalette[4];
uniform int uPass;
varying vec2 vUv;
varying float vStar;
varying float vCentre;
varying float vInvHalf;
varying float vHighlight;

/** Interleaved gradient noise: a cheap, stable dither for the deep gradient. */
float grainNoise(vec2 p) {
  return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
}

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
    // A fraction of a code value of noise removes the banding of the deep gradient.
    float grain = (grainNoise(gl_FragCoord.xy) - 0.5) * (1.8 / 255.0);
    gl_FragColor = vec4(clamp(color * uExposure + grain, 0.0, 1.0), 1.0);
  } else if (uPass == 1) {
    float distance = clamp((vUv.y - vCentre) * vInvHalf, -2.0, 2.0);
    float softness = (1.35 / uResolution.y) * vInvHalf;
    float absolute = abs(distance);
    float ridge = (distance - vHighlight) / 0.34;
    float sheen = 1.0 / (1.0 + 2.72 * ridge * ridge);
    float body = 1.0 - smoothstep(0.18 - softness, 1.0 + softness, absolute);
    float hem = smoothstep(0.70 - softness, 0.93, absolute)
      * (1.0 - smoothstep(0.95, 1.0 + softness, absolute));
    float fade = smoothstep(-0.1, 0.22, vUv.x) * (1.0 - smoothstep(0.82, 1.13, vUv.x));
    float reveal = (1.0 - smoothstep(uProgress - 0.07, uProgress + 0.02, vUv.x))
      * (1.0 - smoothstep(0.72, 1.0, vUv.x));
    float weight = uLayer < 0.5 ? 1.0 : (1.0 - uBoot) * (uLayer < 1.5 ? 0.68 : 0.48);
    float band = 1.0 - smoothstep(0.98, 1.14, absolute);
    float alpha = (body * 0.05 + sheen * 0.17 + hem * 0.045) * band
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
