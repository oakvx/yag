import { memo, useEffect, useRef, type RefObject } from "react";
import { getBootFrame, type BootClock, type WaveFrame } from "./bootState";
import { hourlyBrightness, monthlyPalette } from "./palette";
import { drawWave2D } from "./wave2d";
import { WAVE_FRAGMENT, WAVE_VERTEX } from "./waveShader";

export function emitWave(category: number | null, pulse = 0) {
  window.dispatchEvent(new CustomEvent("yag:wave", { detail: { category, pulse } }));
}

/** Upper bound on the wallpaper's backing store, in pixels. */
const MAX_PIXELS = 8_300_000;

interface GpuRenderer {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  background: WebGLBuffer;
  ribbons: WebGLBuffer;
  dust: WebGLBuffer;
  ribbonCount: number;
  dustCount: number;
  position: number;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

function createRenderer(canvas: HTMLCanvasElement): GpuRenderer | null {
  try {
  const gl = canvas.getContext("webgl", {
    alpha: false, antialias: false, depth: false, stencil: false,
    preserveDrawingBuffer: false, powerPreference: "default",
  });
  if (!gl) return null;

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null; }
    return shader;
  };

  const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  const vertex = precision?.precision ? WAVE_VERTEX : WAVE_VERTEX.replace("precision highp float", "precision mediump float");
  const fragment = precision?.precision ? WAVE_FRAGMENT : WAVE_FRAGMENT.replace("precision highp float", "precision mediump float");
  const vertexShader = compile(gl.VERTEX_SHADER, vertex);
  const fragmentShader = compile(gl.FRAGMENT_SHADER, fragment);
  if (!vertexShader || !fragmentShader) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return null; }

  const background = gl.createBuffer();
  const ribbons = gl.createBuffer();
  const dust = gl.createBuffer();
  if (!background || !ribbons || !dust) { gl.deleteProgram(program); return null; }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, background);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(position);

  // The ribbon pass solves the shape once per column on the vertex stage, so
  // the surface only needs two rows of samples spanning the screen.
  const columns = 512;
  const ribbonVertices = new Float32Array(columns * 4);
  for (let column = 0; column < columns; column++) {
    const x = -1 + 2 * column / (columns - 1);
    ribbonVertices.set([x, -1], column * 4);
    ribbonVertices.set([x, 1], column * 4 + 2);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, ribbons);
  gl.bufferData(gl.ARRAY_BUFFER, ribbonVertices, gl.STATIC_DRAW);

  // Deterministic dust: stable across context restoration and renderer resets.
  let seed = 7173;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const dustCount = 145;
  const points = new Float32Array(dustCount * 2);
  for (let i = 0; i < points.length; i++) points[i] = random();
  gl.bindBuffer(gl.ARRAY_BUFFER, dust);
  gl.bufferData(gl.ARRAY_BUFFER, points, gl.STATIC_DRAW);

  const uniforms: GpuRenderer["uniforms"] = {};
  for (const name of ["uResolution", "uTime", "uProgress", "uBoot", "uBrightness", "uExposure", "uSwell", "uSwellPosition", "uPalette[0]", "uPass", "uLayer"]) {
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { gl, program, background, ribbons, dust, ribbonCount: columns * 2, dustCount, position, uniforms };
  } catch {
    // Some browsers throw instead of returning null when WebGL is disabled.
    return null;
  }
}

/** Persistent WebGL surface: boot and XMB are two states of the same shader. */
export const RibbonWallpaper = memo(function RibbonWallpaper({ clock }: { clock: RefObject<BootClock> }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const gpuRef = useRef<HTMLCanvasElement>(null);
  const fallbackRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = gpuRef.current;
    const fallback = fallbackRef.current;
    if (!wrapper || !canvas || !fallback) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    let renderer = createRenderer(canvas);
    let fallbackContext: CanvasRenderingContext2D | null = null;
    let raf = 0;
    let last = 0;
    let fallbackLastDraw = 0;
    let time = 8;
    let swellStarted = -10;
    let swellStrength = 0;
    let width = 1;
    let height = 1;
    let maxEdge = 2560;
    let observedFrames = 0;
    let slowFrames = 0;
    let palette = monthlyPalette();
    let targetPalette = monthlyPalette();
    let brightness = hourlyBrightness();
    let targetBrightness = brightness;

    const showFallback = () => {
      fallbackContext ??= fallback.getContext("2d", { alpha: false });
      wrapper.dataset.renderer = "2d";
      canvas.style.visibility = "hidden";
      fallback.style.visibility = "visible";
    };
    const showGpu = () => {
      wrapper.dataset.renderer = "webgl";
      canvas.style.visibility = "visible";
      fallback.style.visibility = "hidden";
    };
    if (renderer) showGpu(); else showFallback();

    const applySize = () => {
      const screenW = Math.max(1, window.innerWidth);
      const screenH = Math.max(1, window.innerHeight);
      const cap = Math.min(maxEdge, screenW < 760 ? 1400 : 2560);
      // Render at the display's own pixel density, inside a frame budget that
      // keeps very large screens affordable. The floor keeps the backing store
      // at least as large as the CSS box so the wallpaper is never upscaled.
      const budget = Math.sqrt(MAX_PIXELS / Math.max(1, screenW * screenH));
      const scale = Math.max(
        Math.min(window.devicePixelRatio || 1, cap / Math.max(screenW, screenH), budget),
        Math.min(1, budget),
      );
      width = Math.max(1, Math.round(screenW * scale));
      height = Math.max(1, Math.round(screenH * scale));
      canvas.width = fallback.width = width;
      canvas.height = fallback.height = height;
      renderer?.gl.viewport(0, 0, width, height);
    };
    const resize = () => {
      applySize();
      wake();
    };

    const paint = (frame: WaveFrame) => {
      if (!renderer || renderer.gl.isContextLost()) {
        if (!fallbackContext) showFallback();
        if (fallbackContext) drawWave2D(fallbackContext, width, height, frame);
        return;
      }
      const { gl, uniforms, program } = renderer;
      gl.useProgram(program);
      gl.uniform2f(uniforms.uResolution, width, height);
      gl.uniform1f(uniforms.uTime, frame.time);
      gl.uniform1f(uniforms.uProgress, frame.progress);
      gl.uniform1f(uniforms.uBoot, frame.boot);
      gl.uniform1f(uniforms.uBrightness, frame.brightness);
      gl.uniform1f(uniforms.uExposure, frame.exposure);
      gl.uniform1f(uniforms.uSwell, frame.swell);
      gl.uniform1f(uniforms.uSwellPosition, frame.swellPosition);
      gl.uniform3fv(uniforms["uPalette[0]"], frame.palette);
      gl.disable(gl.BLEND);
      gl.uniform1i(uniforms.uPass, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.background);
      gl.vertexAttribPointer(renderer.position, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (frame.exposure <= 0.001) return;

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.uniform1i(uniforms.uPass, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.ribbons);
      gl.vertexAttribPointer(renderer.position, 2, gl.FLOAT, false, 0, 0);
      const layers = frame.boot > 0.999 ? 1 : 3;
      for (let layer = 0; layer < layers; layer++) {
        gl.uniform1f(uniforms.uLayer, layer);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, renderer.ribbonCount);
      }
      gl.uniform1i(uniforms.uPass, 2);
      gl.bindBuffer(gl.ARRAY_BUFFER, renderer.dust);
      gl.vertexAttribPointer(renderer.position, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, renderer.dustCount);
      gl.disable(gl.BLEND);
    };

    const loop = (now: number) => {
      raf = 0;
      if (document.hidden) return;
      const interval = last ? (now - last) / 1000 : 0;
      const dt = Math.min(interval, 0.05);
      last = now;
      if (!reduced) time += dt;
      // Lower internal resolution on sustained slow frames; the CSS size stays unchanged.
      if (renderer && !reduced && interval > 0) {
        observedFrames++;
        if (interval > 0.023) slowFrames++;
        if (observedFrames >= 24) {
          const cssEdge = Math.max(window.innerWidth, window.innerHeight);
          if (slowFrames / observedFrames > 0.4 && Math.max(width, height) > cssEdge * 0.75) {
            // Scale down for struggling devices, but never past three quarters
            // of the CSS size: heavy upscaling is what makes the wallpaper look
            // soft and stretched.
            maxEdge = Math.max(Math.round(cssEdge * 0.75), Math.round(Math.max(width, height) * 0.8));
            applySize();
          }
          observedFrames = slowFrames = 0;
        }
      }
      const blend = reduced ? 1 : 1 - Math.exp(-dt * 0.7);
      let paletteMoving = false;
      for (let i = 0; i < palette.length; i++) {
        const difference = targetPalette[i] - palette[i];
        palette[i] += difference * blend;
        if (Math.abs(difference) > 0.0005) paletteMoving = true;
      }
      brightness += (targetBrightness - brightness) * blend;
      if (Math.abs(targetBrightness - brightness) > 0.0005) paletteMoving = true;
      const age = time - swellStarted;
      const swell = !reduced && age >= 0 && age < 1.8 ? swellStrength * (1 - age / 1.8) : 0;
      const current = getBootFrame(clock.current);
      const frame: WaveFrame = {
        ...current, time: reduced ? 8 : time, brightness, palette,
        swell, swellPosition: -0.18 + Math.max(0, age) * 0.76,
      };
      // The legacy Canvas2D fallback is capped at 30 fps; WebGL follows the display refresh.
      if (renderer || now - fallbackLastDraw >= 33 || reduced) {
        paint(frame);
        fallbackLastDraw = now;
      }
      const bootRunning = clock.current.stage === "playing" || clock.current.stage === "handoff";
      if (!document.hidden && (bootRunning || (!reduced && clock.current.stage === "home") || paletteMoving)) {
        raf = requestAnimationFrame(loop);
      }
    };

    function wake() {
      if (!raf && !document.hidden) { last = 0; raf = requestAnimationFrame(loop); }
    }

    const wave = (event: Event) => {
      const detail = (event as CustomEvent<{ pulse?: number }>).detail;
      // Categories move the ribbons, but never change the monthly palette.
      if (!reduced && clock.current.stage === "home") {
        swellStarted = time;
        swellStrength = Math.min(1, Math.max(0, detail?.pulse ?? 0.22));
        wake();
      }
    };
    const bootChanged = () => wake();
    const visibility = () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; last = 0; }
      else wake();
    };
    const motionChanged = () => {
      reduced = motion.matches;
      clock.current.reduced = reduced;
      if (reduced) { palette = targetPalette.slice(); brightness = targetBrightness; }
      wake();
    };
    const lost = (event: Event) => {
      event.preventDefault();
      renderer = null;
      showFallback();
      wake();
    };
    const restored = () => {
      renderer = createRenderer(canvas);
      if (renderer) { renderer.gl.viewport(0, 0, width, height); showGpu(); }
      else showFallback();
      wake();
    };

    const calendar = window.setInterval(() => {
      targetPalette = monthlyPalette();
      targetBrightness = hourlyBrightness();
      wake();
    }, 60000);

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("yag:wave", wave);
    window.addEventListener("yag:boot", bootChanged);
    document.addEventListener("visibilitychange", visibility);
    motion.addEventListener("change", motionChanged);
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(calendar);
      window.removeEventListener("resize", resize);
      window.removeEventListener("yag:wave", wave);
      window.removeEventListener("yag:boot", bootChanged);
      document.removeEventListener("visibilitychange", visibility);
      motion.removeEventListener("change", motionChanged);
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      if (renderer && !renderer.gl.isContextLost()) {
        renderer.gl.deleteBuffer(renderer.background);
        renderer.gl.deleteBuffer(renderer.ribbons);
        renderer.gl.deleteBuffer(renderer.dust);
        renderer.gl.deleteProgram(renderer.program);
      }
    };
  }, [clock]);

  return (
    <div ref={wrapperRef} className="console-wallpaper" aria-hidden="true">
      <canvas ref={gpuRef} className="wallpaper-canvas" />
      <canvas ref={fallbackRef} className="wallpaper-canvas" style={{ visibility: "hidden" }} />
    </div>
  );
});