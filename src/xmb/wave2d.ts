import type { WaveFrame } from "./bootState";
import { waveBand, WAVE_DUST, WAVE_LAYERS } from "./waveProfile";

/** Canvas2D fallback keeps the same shared timeline if WebGL is unavailable or lost. */
export function drawWave2D(ctx: CanvasRenderingContext2D, w: number, h: number, frame: WaveFrame) {
  const { boot, exposure, time, palette, swell, swellPosition } = frame;
  const css = (values: number[], alpha = 1) => `rgba(${values.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(",")},${alpha})`;
  const ribbonColor = [palette[6], palette[7], palette[8]];

  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  if (exposure <= 0) return;

  const compact = (typeof window === "undefined" ? w : window.innerWidth) < 760;
  const samples = compact ? 120 : 220;
  const step = w / samples;

  // The same analytic band the shader draws, so the fallback keeps the look.
  const band = (layer: number, x: number) => {
    const nx = x / w;
    const field = waveBand(nx, time, layer, boot);
    const pulse = swellPosition - nx;
    const impulse = swell * 0.018 * Math.exp(-pulse * pulse * 32) * Math.sin(-pulse * 20 + WAVE_LAYERS[layer].phase);
    return {
      ...field, centre: h * (field.centre + impulse), half: h * field.half,
    };
  };

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let layer = 0; layer < WAVE_LAYERS.length; layer++) {
    const weight = WAVE_LAYERS[layer].weight * waveBand(0.5, time, layer, boot).shimmer;
    const middle: [number, number][] = [];
    const halves: number[] = [];
    for (let s = 0; s <= samples; s++) {
      const x = s * step;
      const b = band(layer, x);
      middle.push([x, b.centre]);
      halves.push(b.half);
    }
    // Concentric bands approximate the soft light profile of the shader.
    const passes = 16;
    const ramp = (0.31 - 0.07 * boot) * (1 - boot * 0.65) / (passes * (passes + 1) / 2);
    for (let pass = 0; pass < passes; pass++) {
      const ratio = 1.7 - (pass / (passes - 1)) * 1.5;
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
    // Fine silk strands belong to the material in both gathered and open states.
    for (let thread = 0; thread < (boot > 0 ? 4 : 2); thread++) {
      ctx.beginPath();
      for (let s = 0; s <= samples; s++) {
        const x = s * step;
        const b = band(layer, x);
        const highlight = 0.42 * Math.sin(b.twist * 1.15 + 0.7);
        const offset = thread >= 2 ? (thread === 2 ? -0.88 : 0.88)
          : thread === 0 ? 0.36 * Math.sin(s / samples * 4.2 + highlight * 2 + layer)
          : -0.48 * Math.sin(s / samples * 3.3 - highlight + layer * 1.7);
        const y = b.centre + b.half * offset;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.lineWidth = Math.max(0.7, h * (boot * 0.0006 + (1 - boot) * 0.002));
      ctx.strokeStyle = css(ribbonColor, weight * exposure * (thread >= 2 ? boot * 0.07 : (0.15 - 0.03 * boot) * (1 - boot * 0.88)));
      ctx.stroke();
    }
  }
  const dustCount = compact ? 220 : WAVE_DUST.length;
  for (let i = 0; i < dustCount; i++) {
    const mote = WAVE_DUST[i];
    const x = (mote.x + time * 0.0012) % 1;
    const b = band(1, x * w);
    const y = b.centre + (mote.y - 0.5) * b.half * 5;
    const twinkle = (0.35 + 0.65 * Math.abs(Math.sin(time * (0.8 + mote.y * 1.9) + mote.x * 77))) * (1 - boot * 0.92);
    const flare = i % (boot > 0 ? 19 : 14) === 0;
    const radius = flare ? Math.max(2, w / 550) : Math.max(0.55, w / 1800);
    if (flare) {
      const glow = ctx.createRadialGradient(x * w, y, 0, x * w, y, radius * 2.5);
      glow.addColorStop(0, css(ribbonColor, 0.15 * twinkle * exposure));
      glow.addColorStop(1, css(ribbonColor, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(x * w - radius * 2.5, y - radius * 2.5, radius * 5, radius * 5);
    }
    ctx.fillStyle = css(ribbonColor, twinkle * exposure * 0.24);
    ctx.beginPath(); ctx.arc(x * w, y, radius, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";
}
