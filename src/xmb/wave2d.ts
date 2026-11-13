import type { WaveFrame } from "./bootState";

interface Ribbon { phase: number; width: number; centre: number; slope: number; opacity: number }
const RIBBONS: Ribbon[] = [
  { phase: 1.15, width: 0.175, centre: 0.51, slope: -0.035, opacity: 0.62 },
  { phase: 3.65, width: 0.105, centre: 0.52, slope: 0.03, opacity: 0.8 },
  { phase: 5.4, width: 0.125, centre: 0.535, slope: -0.014, opacity: 0.52 },
];

/** Canvas2D fallback keeps the same shared timeline if WebGL is unavailable or lost. */
export function drawWave2D(ctx: CanvasRenderingContext2D, w: number, h: number, frame: WaveFrame) {
  const { boot, progress, exposure, brightness, time, palette, swell, swellPosition } = frame;
  const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
  const css = (values: number[], alpha = 1) => `rgba(${values.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(",")},${alpha})`;
  const colors = [0, 1, 2].map((i) => [
    mix(palette[i] * brightness, [0.16, 0.055, 0.23][i], boot),
    mix(palette[3 + i] * brightness, [0.012, 0.006, 0.026][i], boot),
    mix(palette[6 + i], [0.94, 0.82, 1][i], boot),
  ]);
  const top = colors.map((c) => c[0]);
  const bottom = colors.map((c) => c[1]);
  const ribbonColor = colors.map((c) => c[2]);

  ctx.globalCompositeOperation = "source-over";
  const bg = ctx.createLinearGradient(w * 0.8, 0, w * 0.1, h);
  bg.addColorStop(0, css(top.map((v) => v * exposure)));
  bg.addColorStop(1, css(bottom.map((v) => v * exposure)));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (exposure <= 0 || progress <= 0) return;

  const segs = w < 760 ? 68 : 100;
  const bands = w < 760 ? 12 : 22;
  const step = w / segs;
  const point = (r: Ribbon, x: number, v: number) => {
    const n = x / w * 2 - 1;
    const twist = n * 3.8 - time * 0.12 + r.phase;
    const homeCenter = h * (r.centre + r.slope * n + Math.sin(n * 3.5 - time * 0.06 + r.phase) * 0.038);
    const bootCenter = h * (0.36 - x / w * 0.045 + Math.sin(n * 2.1 - time * 0.06) * 0.015);
    const spread = h * mix(r.width * (0.55 + 0.45 * Math.abs(Math.cos(n * 2.3 + r.phase))), 0.018 + 0.12 * Math.sin(Math.PI * Math.max(0, Math.min(1, x / w))), boot);
    const pulseDist = x / w - swellPosition;
    const impulse = swell * h * 0.02 * Math.exp(-pulseDist * pulseDist * 24) * Math.sin(pulseDist * 16 + r.phase);
    return mix(homeCenter, bootCenter, boot) + v * spread * Math.cos(twist) + Math.sin(v * 2.7 + twist) * spread * 0.36 + impulse;
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w * Math.min(1, progress * 1.08), h);
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  for (let index = 0; index < RIBBONS.length; index++) {
    const r = RIBBONS[index];
    const weight = index === 0 ? 1 : 1 - boot;
    if (weight <= 0) continue;
    for (let band = 0; band < bands; band++) {
      const v0 = -1 + 2 * band / bands;
      const v1 = -1 + 2 * (band + 1) / bands;
      const sheen = Math.pow(Math.abs(Math.sin((v0 + v1) * 1.85 + r.phase + time * 0.08)), 9);
      const alpha = (0.014 + sheen * 0.05) * r.opacity * weight * exposure;
      ctx.beginPath();
      for (let s = 0; s <= segs; s++) {
        const x = s * step;
        const y = point(r, x, v0);
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (let s = segs; s >= 0; s--) ctx.lineTo(s * step, point(r, s * step, v1));
      ctx.closePath();
      ctx.fillStyle = css(ribbonColor, alpha);
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}