import type { WaveFrame } from "./bootState";

interface Ribbon { phase: number; offset: number; width: number; weight: number }
const RIBBONS: Ribbon[] = [
  { phase: 0.4, offset: -0.045, width: 1.0, weight: 1.0 },
  { phase: 2.55, offset: 0.0, width: 0.9, weight: 0.68 },
  { phase: 4.7, offset: 0.045, width: 0.82, weight: 0.48 },
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

  const t = time * 0.075;
  const samples = w < 760 ? 120 : 220;
  const step = w / samples;

  // The same analytic band the shader draws, so the fallback keeps the look.
  const band = (r: Ribbon, x: number) => {
    const nx = x / w;
    const phase = r.phase;
    const travelling = nx * 4.1 - t + phase;
    const secondary = nx * 8.0 - t * 0.39 + phase * 1.6;
    const twist = nx * 3.8 - t * 0.72 + phase;
    const wave = 0.5 + 0.5 * Math.sin(twist);
    const homeCentre = 0.505 + r.offset
      + 0.041 * Math.sin(travelling) + 0.018 * Math.sin(secondary) - (nx - 0.5) * 0.037;
    const homeHalf = (0.030 + 0.082 * wave * wave) * r.width;
    const bootCentre = 0.36 - nx * 0.065 + 0.012 * Math.sin(nx * 4.0 - t * 0.65);
    const bootHalf = 0.008 + 0.115 * Math.sqrt(Math.max(0, Math.sin(Math.max(0, Math.min(1, nx)) * Math.PI)))
      * (0.6 + 0.4 * (0.5 + 0.5 * Math.cos(twist * 2.0)));
    const pulse = swellPosition - nx;
    const impulse = swell * 0.018 * Math.exp(-pulse * pulse * 32) * Math.sin(-pulse * 20 + phase);
    return {
      centre: h * (mix(homeCentre, bootCentre, boot) + impulse),
      half: h * mix(homeHalf, bootHalf, boot),
      twist,
    };
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w * Math.min(1, progress * 1.08), h);
  ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const r of RIBBONS) {
    const weight = r.weight === 1 ? 1 : (1 - boot) * r.weight;
    if (weight <= 0) continue;
    const middle: [number, number][] = [];
    const halves: number[] = [];
    for (let s = 0; s <= samples; s++) {
      const x = s * step;
      const b = band(r, x);
      middle.push([x, b.centre]);
      halves.push(b.half);
    }
    // Concentric bands approximate the soft light profile of the shader.
    const passes = 16;
    const ramp = 0.13 / (passes * (passes + 1) / 2);
    for (let pass = 0; pass < passes; pass++) {
      const ratio = 1.12 - (pass / (passes - 1)) * 0.9;
      const alpha = ramp * (passes - pass) * weight * exposure;
      ctx.beginPath();
      for (let s = 0; s < middle.length; s++) {
        const [x, y] = middle[s];
        const offset = halves[s] * ratio;
        if (s === 0) ctx.moveTo(x, y - offset);
        else ctx.lineTo(x, y - offset);
      }
      for (let s = middle.length - 1; s >= 0; s--) {
        const [x, y] = middle[s];
        ctx.lineTo(x, y + halves[s] * ratio);
      }
      ctx.closePath();
      ctx.fillStyle = css(ribbonColor, alpha);
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}
