// A single WebGL program renders the deformable ribbons and dust.
// The ribbons are evaluated analytically instead of through a folded mesh: a mesh
// produced hard cusps along its silhouette (visible stair-steps), while the
// analytic form stays smooth at any resolution. The ribbon shape is solved once
// per column on the vertex stage, so every pixel only pays for the shading.
import { WAVE_FIELD_GLSL } from "./waveProfile";

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
varying float vHalo;
varying float vCentre;
varying float vInvHalf;
varying float vHighlight;
varying float vShimmer;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

${WAVE_FIELD_GLSL}

void main() {
  vUv = vec2(0.0);
  vStar = 0.0;
  vHalo = 0.0;
  vCentre = 0.0;
  vInvHalf = 1.0;
  vHighlight = 0.0;
  vShimmer = 1.0;
  if (uPass == 2) {
    float x = fract(aPosition.x + uTime * 0.0012);
    float t = fieldTime(uTime, 1.0);
    float seed = hash21(aPosition);
    float phase = fieldPhase(1.0);
    float centre = fieldCentre(x, t, phase, 1.0, uBoot);
    float halfWidth = fieldHalf(x, t, phase, 1.0, uBoot);
    float y = centre + (seed - 0.5) * 2.0 * halfWidth * 3.4;
    // A few motes run larger and carry a soft halo; the rest stay fine.
    vHalo = step(mix(0.88, 0.92, uBoot), hash21(aPosition + vec2(9.1, 3.7)));
    gl_PointSize = mix(1.0, 2.8, hash21(aPosition + vec2(3.1, 7.3)))
      * mix(1.0, 2.4, vHalo) * clamp(uResolution.x / 1200.0, 0.8, 1.7);
    // Faster, uneven twinkle: every mote runs on its own clock and phase.
    vStar = (0.35 + 0.65 * abs(sin(uTime * (0.8 + seed * 1.9) + aPosition.x * 77.0 + seed * 39.0)))
      * mix(0.4, 1.0, smoothstep(0.28, 0.8, x));
    gl_Position = vec4(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  } else if (uPass == 1) {
    float x = aPosition.x * 0.5 + 0.5;
    float layer = uLayer;
    float phase = fieldPhase(layer);
    float t = fieldTime(uTime, layer);
    float twist = fieldTwist(x, t, phase);
    float centre = fieldCentre(x, t, phase, layer, uBoot);
    float halfWidth = max(fieldHalf(x, t, phase, layer, uBoot), 0.002);
    vShimmer = fieldShimmer(t, phase);
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
    float y = centre + (row * 2.0 - 1.0) * halfWidth * 1.7;
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
uniform float uBoot;
uniform float uExposure;
uniform float uLayer;
uniform vec3 uPalette[4];
uniform int uPass;
varying vec2 vUv;
varying float vStar;
varying float vHalo;
varying float vCentre;
varying float vInvHalf;
varying float vHighlight;
varying float vShimmer;

void main() {
  if (uExposure <= 0.001) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  if (uPass == 1) {
    float distance = clamp((vUv.y - vCentre) * vInvHalf, -2.0, 2.0);
    float softness = (1.35 / uResolution.y) * vInvHalf;
    float absolute = abs(distance);
    float ridge = (distance - vHighlight) / 0.34;
    float sheen = 1.0 / (1.0 + 2.72 * ridge * ridge);
    // Localized specular: a bright spot that slides across the ribbon
    float specX = fract(vUv.x * 0.5 + uTime * 0.018);
    float specD = (specX - 0.5) * 4.0;
    float specular = exp(-specD * specD * 1.8) * sheen * 0.35;
    float body = 1.0 - smoothstep(0.15 - softness, 1.0 + softness, absolute);
    float hem = smoothstep(0.65 - softness, 0.90, absolute)
      * (1.0 - smoothstep(0.92, 1.0 + softness, absolute));
    float fade = smoothstep(-0.1, 0.22, vUv.x) * (1.0 - smoothstep(0.82, 1.13, vUv.x));
    float weight = uLayer < 0.5 ? 1.0 : (uLayer < 1.5 ? 0.68 : (uLayer < 2.5 ? 0.48 : 0.26));
    float band = 1.0 - smoothstep(1.4, 1.7, absolute);
    float bloom = exp(-distance * distance * 1.9);
    float threadA = (distance - 0.36 * sin(vUv.x * 4.2 + vHighlight * 2.0 + uLayer)) / 0.055;
    float threadB = (distance + 0.48 * sin(vUv.x * 3.3 - vHighlight + uLayer * 1.7)) / 0.045;
    float threads = exp(-threadA * threadA) * 0.10 + exp(-threadB * threadB) * 0.065;
    float homeLight = body * 0.12 + sheen * 0.40 + hem * 0.09 + bloom * 0.095 + threads + specular;
    float gatheredLight = body * 0.11 + sheen * 0.08 + hem * 0.09 + bloom * 0.012 + threads * 0.22;
    float alpha = mix(homeLight, gatheredLight, uBoot) * band
      * fade * weight * uExposure * vShimmer * 1.05;
    vec3 color = uPalette[2];
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  } else {
    float radius = length(gl_PointCoord - vec2(0.5));
    float core = 1.0 - smoothstep(0.1, 0.5, radius);
    // The halo is a soft ring just outside the core, for the larger motes.
    float halo = smoothstep(0.1, 0.28, radius) * (1.0 - smoothstep(0.26, 0.5, radius));
    float glow = exp(-radius * radius * 6.0) * 0.3;
    float alpha = (core + vHalo * halo * 0.9 + glow) * vStar * 0.28 * uExposure * mix(1.0, 0.08, uBoot);
    gl_FragColor = vec4(mix(vec3(1.0), uPalette[2], 0.25), alpha);
  }
}
`;
