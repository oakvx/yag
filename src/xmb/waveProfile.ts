/** One material and one continuous field, shared by WebGL, Canvas and boot. */
export const WAVE_MOTION = {
  speed: 0.30, horizontalAmplitude: 0.085, verticalAmplitude: 0.028,
  driftAmplitude: 0.038, rippleAmplitude: 0.015,
  layerSpeed: 0.11, layerPhase: 2.35, shimmerSpeed: 0.65, shimmerAmplitude: 0.15,
} as const;
export const BOOT_MATERIAL = { backdropExposure: 0.28, paletteWash: 0.62, warmth: [1, 0.96, 0.72] } as const;
const PROFILE = {
  baseline: 0.55, sag: 0.17, slope: 0.022, half: 0.038, twistWidth: 0.10,
  gatheredCentre: 0.53, gatheredAnchor: 0.65, gatheredSpread: 0.58, gatheredWidth: 0.65, gatheredSlope: 0.075,
};
export const WAVE_LAYERS = [1, 0.68, 0.48, 0.22].map((weight, layer) => ({
  phase: 0.4 + layer * WAVE_MOTION.layerPhase,
  speed: 1 + layer * WAVE_MOTION.layerSpeed,
  offset: (layer - 1) * 0.025, width: 1 - layer * 0.1, weight,
}));

export function waveBand(x: number, time: number, layer: number, boot: number) {
  const r = WAVE_LAYERS[layer];
  const t = time * WAVE_MOTION.speed * r.speed;
  const flow = x + WAVE_MOTION.horizontalAmplitude * Math.sin(t * 0.61 + r.phase);
  const twist = flow * 3.8 - t * 0.72 + r.phase;
  const wave = 0.5 + 0.5 * Math.sin(twist);
  const home = PROFILE.baseline + PROFILE.sag * Math.sin(Math.PI * x) + PROFILE.slope * x + r.offset
    + WAVE_MOTION.verticalAmplitude * Math.sin(t * 0.53 + r.phase * 0.7)
    + WAVE_MOTION.driftAmplitude * Math.sin(flow * 4.1 - t + r.phase)
    + WAVE_MOTION.rippleAmplitude * Math.sin(flow * 8 - t * 0.39 + r.phase * 1.6);
  const gathered = PROFILE.gatheredCentre
    + (home - PROFILE.gatheredAnchor - PROFILE.sag * Math.sin(Math.PI * x)) * PROFILE.gatheredSpread
    + PROFILE.gatheredSlope * x;
  return {
    centre: home + (gathered - home) * boot,
    half: (PROFILE.half + PROFILE.twistWidth * wave * wave) * r.width * (1.3 - 0.3 * boot) * (1 + (PROFILE.gatheredWidth - 1) * boot),
    twist,
    shimmer: 1 - WAVE_MOTION.shimmerAmplitude + WAVE_MOTION.shimmerAmplitude * Math.sin(t * WAVE_MOTION.shimmerSpeed + r.phase),
  };
}

const f = (n: number) => n.toFixed(6);
export const WAVE_FIELD_GLSL = `
float fieldTime(float time, float layer) { return time * ${f(WAVE_MOTION.speed)} * (1.0 + layer * ${f(WAVE_MOTION.layerSpeed)}); }
float fieldPhase(float layer) { return 0.4 + layer * ${f(WAVE_MOTION.layerPhase)}; }
float fieldFlow(float x, float t, float phase) { return x + ${f(WAVE_MOTION.horizontalAmplitude)} * sin(t * 0.61 + phase); }
float fieldTwist(float x, float t, float phase) { return fieldFlow(x, t, phase) * 3.8 - t * 0.72 + phase; }
float fieldCentre(float x, float t, float phase, float layer, float boot) {
  float flow = fieldFlow(x, t, phase);
  float home = ${f(PROFILE.baseline)} + ${f(PROFILE.sag)} * sin(3.14159265 * x) + ${f(PROFILE.slope)} * x + (layer - 1.0) * 0.025
    + ${f(WAVE_MOTION.verticalAmplitude)} * sin(t * 0.53 + phase * 0.7)
    + ${f(WAVE_MOTION.driftAmplitude)} * sin(flow * 4.1 - t + phase)
    + ${f(WAVE_MOTION.rippleAmplitude)} * sin(flow * 8.0 - t * 0.39 + phase * 1.6);
  float gathered = ${f(PROFILE.gatheredCentre)}
    + (home - ${f(PROFILE.gatheredAnchor)} - ${f(PROFILE.sag)} * sin(3.14159265 * x)) * ${f(PROFILE.gatheredSpread)}
    + ${f(PROFILE.gatheredSlope)} * x;
  return mix(home, gathered, boot);
}
float fieldHalf(float x, float t, float phase, float layer, float boot) {
  float wave = 0.5 + 0.5 * sin(fieldTwist(x, t, phase));
  return (${f(PROFILE.half)} + ${f(PROFILE.twistWidth)} * wave * wave) * (1.0 - layer * 0.1) * mix(1.3, 1.0, boot) * mix(1.0, ${f(PROFILE.gatheredWidth)}, boot);
}
float fieldShimmer(float t, float phase) { return ${f(1 - WAVE_MOTION.shimmerAmplitude)} + ${f(WAVE_MOTION.shimmerAmplitude)} * sin(t * ${f(WAVE_MOTION.shimmerSpeed)} + phase); }
`;

/** The same motes survive renderer switches and context restoration. */
export const WAVE_DUST = (() => {
  let seed = 7173;
  const random = () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; };
  return Array.from({ length: 400 }, () => ({ x: random(), y: random() }));
})();
