import { assetExists, hasOptionalAsset, publicAsset } from "./assets";

export type SoundEffect = "move" | "select" | "back" | "category" | "trophy";
export interface AudioPreferences { music: boolean; effects: boolean; master: number }

const STORAGE_KEY = "yag-xmb-audio-v2";
/** Exposed so the profile page can report where the audio preferences live. */
export const AUDIO_STORAGE_KEY = STORAGE_KEY;

const DEFAULTS: AudioPreferences = { music: true, effects: true, master: 0.6 };
const SLOTS: Record<"boot" | "home" | SoundEffect, string[]> = {
  boot: ["audio/yag-boot.mp3"],
  home: ["audio/yag-home.mp3", "audio/yag-home.ogg"],
  move: ["audio/yag-cursor.mp3"],
  select: ["audio/yag-select.mp3"],
  back: ["audio/yag-cancel.mp3"],
  category: ["audio/yag-cursor.mp3"],
  trophy: ["audio/yag-trophy.mp3"],
};

function readPreferences(): AudioPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<AudioPreferences> | null;
    return {
      music: typeof stored?.music === "boolean" ? stored.music : DEFAULTS.music,
      effects: typeof stored?.effects === "boolean" ? stored.effects : DEFAULTS.effects,
      master: typeof stored?.master === "number" && Number.isFinite(stored.master)
        ? Math.min(1, Math.max(0, stored.master)) : DEFAULTS.master,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function ramp(node: GainNode | null, value: number, seconds: number, context: AudioContext | null) {
  if (!node || !context) return;
  const now = context.currentTime;
  node.gain.cancelScheduledValues(now);
  node.gain.setValueAtTime(node.gain.value, now);
  node.gain.linearRampToValueAtTime(value, now + Math.max(0.01, seconds));
}

/** One audio graph, unlocked only by a gesture. Missing files resolve to silence. */
class XmbAudio {
  private preferences = readPreferences();
  private listeners = new Set<() => void>();
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private effects: GainNode | null = null;
  private bootGain: GainNode | null = null;
  private homeGain: GainNode | null = null;
  private bootSource: AudioBufferSourceNode | null = null;
  private homeSource: AudioBufferSourceNode | null = null;
  private cache = new Map<keyof typeof SLOTS, Promise<AudioBuffer | null>>();
  private phase: "idle" | "boot" | "home" = "idle";
  private bootStartedAt = 0;
  private bootGeneration = 0;
  private inApp = false;
  private unlocked = false;
  private media: Partial<Record<"boot" | "home", HTMLAudioElement>> = {};
  private mediaLevel: Record<"boot" | "home", number> = { boot: 0, home: 0 };
  private mediaFrames: Partial<Record<"boot" | "home", number>> = {};
  /** The procedural home pad, used while no home track is supplied in public/. */
  private synthHome: { stop: () => void } | null = null;

  getPreferences = () => this.preferences;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  setPreferences(patch: Partial<AudioPreferences>) {
    this.preferences = {
      ...this.preferences,
      ...patch,
      master: Math.min(1, Math.max(0, patch.master ?? this.preferences.master)),
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.preferences)); } catch { /* optional */ }
    ramp(this.master, this.preferences.master, 0.18, this.context);
    ramp(this.effects, this.preferences.effects ? 1 : 0, 0.18, this.context);
    this.updateMusicLevel();
    this.updateMediaVolumes();
    if (this.unlocked && this.phase === "home" && this.preferences.music) this.ensureHome();
    this.listeners.forEach((listener) => listener());
  }

  /** Must be called directly inside a key or pointer gesture. */
  unlock() {
    if (!this.context) {
      try {
        const AudioConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioConstructor) {
          const ctx = new AudioConstructor();
          this.context = ctx;
          this.master = ctx.createGain();
          this.music = ctx.createGain();
          this.effects = ctx.createGain();
          this.bootGain = ctx.createGain();
          this.homeGain = ctx.createGain();
          this.master.gain.value = this.preferences.master;
          this.music.gain.value = this.preferences.music ? (this.inApp ? 0.25 : 1) : 0;
          this.effects.gain.value = this.preferences.effects ? 1 : 0;
          this.bootGain.gain.value = 0;
          this.homeGain.gain.value = 0;
          this.bootGain.connect(this.music);
          this.homeGain.connect(this.music);
          this.music.connect(this.master);
          this.effects.connect(this.master);
          this.master.connect(ctx.destination);
        }
      } catch { /* HTMLAudioElement can still play files if available. */ }
    }
    this.unlocked = true;
    if (this.context?.state === "suspended" && !document.hidden) void this.context.resume().catch(() => {});
    if (this.phase === "home" && this.preferences.music) this.ensureHome();
  }

  private async load(slot: keyof typeof SLOTS): Promise<AudioBuffer | null> {
    if (!this.context || window.location.protocol === "file:") return null;
    const cached = this.cache.get(slot);
    if (cached) return cached;
    const promise = (async () => {
      for (const path of SLOTS[slot]) {
        try {
          if (!await assetExists(path, "audio")) continue;
          const response = await fetch(publicAsset(path));
          if (!response.ok || (response.headers.get("content-type") || "").includes("text/html")) continue;
          return await this.context!.decodeAudioData(await response.arrayBuffer());
        } catch { /* Try the next supported format. */ }
      }
      return null;
    })();
    this.cache.set(slot, promise);
    return promise;
  }

  blip(kind: SoundEffect) {
    if (!this.preferences.effects || !this.unlocked || document.hidden) return;
    // A supplied file wins; without one the console voices itself.
    if (hasOptionalAsset(SLOTS[kind][0])) this.playFileEffect(kind);
    else this.synthEffect(kind);
  }

  /** Short, soft, glassy tones: original synthesis, no samples. */
  private synthEffect(kind: SoundEffect) {
    const ctx = this.context;
    const out = this.effects;
    if (!ctx || !out || ctx.state === "closed") return;
    const t0 = ctx.currentTime;
    const tone = (freq: number, at: number, dur: number, peak: number, type: OscillatorType = "sine", glideTo?: number) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0 + at);
      if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + at + dur);
      env.gain.setValueAtTime(0.0001, t0 + at);
      env.gain.linearRampToValueAtTime(peak, t0 + at + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(env);
      env.connect(out);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.02);
      osc.onended = () => { osc.disconnect(); env.disconnect(); };
    };
    switch (kind) {
      case "move":
        tone(1480, 0, 0.09, 0.13, "sine", 1320);
        tone(2960, 0, 0.05, 0.03);
        break;
      case "category":
        tone(988, 0, 0.13, 0.11, "sine", 1100);
        tone(1480, 0.05, 0.2, 0.07);
        break;
      case "select":
        tone(659, 0, 0.16, 0.14);
        tone(988, 0.07, 0.22, 0.12);
        tone(1318, 0.12, 0.32, 0.08);
        break;
      case "back":
        tone(988, 0, 0.12, 0.12, "sine", 740);
        tone(659, 0.07, 0.22, 0.1);
        break;
      case "trophy":
        [784, 988, 1175, 1568, 2093].forEach((freq, i) => tone(freq, i * 0.08, 0.6, 0.09, "triangle"));
        tone(3136, 0.28, 0.7, 0.025);
        tone(784, 0.32, 0.8, 0.04, "sine");
        break;
    }
  }

  /** A slow, warm pad under the menu: five sines, a low-pass, a drifting level. */
  private startSynthHome(fade: number) {
    const ctx = this.context;
    const out = this.homeGain;
    if (!ctx || !out || this.synthHome) return;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    const level = ctx.createGain();
    level.gain.value = 0.55;
    filter.connect(level);
    level.connect(out);
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoDepth.gain.value = 0.18;
    lfo.connect(lfoDepth);
    lfoDepth.connect(level.gain);
    lfo.start();
    const voices = [146.83, 220, 293.66, 369.99, 440].map((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.detune.value = (i - 2) * 4;
      gain.gain.value = 0.07 - i * 0.008;
      osc.connect(gain);
      gain.connect(filter);
      osc.start();
      return { osc, gain };
    });
    this.synthHome = {
      stop: () => {
        const at = ctx.currentTime + 0.1;
        for (const { osc, gain } of voices) { try { osc.stop(at); } catch { /* already stopped */ } gain.disconnect(); }
        try { lfo.stop(at); } catch { /* already stopped */ }
        lfoDepth.disconnect();
        filter.disconnect();
        level.disconnect();
      },
    };
    ramp(out, 1, fade, ctx);
  }

  private stopSynthHome() {
    this.synthHome?.stop();
    this.synthHome = null;
  }

  /** An orchestral swell: layered detuned sines simulating strings,
   *  a sub-bass foundation, and a convolver for hall reverb. */
  private synthBoot() {
    const ctx = this.context;
    const out = this.bootGain;
    if (!ctx || !out) return;
    const t0 = ctx.currentTime;
    ramp(out, 1, 0.3, ctx);

    // Create a small reverb impulse for hall space
    const reverbLen = 2.0;
    const reverbBuf = ctx.createBuffer(2, Math.floor(ctx.sampleRate * reverbLen), ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = reverbBuf.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.6)) * 0.3;
      }
    }
    const reverb = ctx.createConvolver();
    reverb.buffer = reverbBuf;
    const reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.35;
    reverb.connect(reverbGain);
    reverbGain.connect(out);

    const dry = ctx.createGain();
    dry.gain.value = 0.65;
    dry.connect(out);

    // LPF that slowly opens during the swell
    const lpf = ctx.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.setValueAtTime(400, t0);
    lpf.frequency.exponentialRampToValueAtTime(2400, t0 + 3.2);
    lpf.frequency.exponentialRampToValueAtTime(800, t0 + 5.0);
    lpf.Q.value = 0.7;
    lpf.connect(dry);
    lpf.connect(reverb);

    // String ensemble: 10 detuned voices at chord tones
    const chordFreqs = [146.83, 174.61, 220, 293.66, 349.23, 440, 523.25, 587.33, 659.25, 880];
    chordFreqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * 0.5, t0);
      osc.frequency.exponentialRampToValueAtTime(freq, t0 + 2.8);
      osc.detune.value = (i - 5) * 6; // slight ensemble detuning
      const peak = 0.035 - i * 0.002;
      const onset = i * 0.18;
      env.gain.setValueAtTime(0.0001, t0 + onset);
      env.gain.linearRampToValueAtTime(Math.max(0.008, peak), t0 + 2.0 + onset * 0.3);
      env.gain.linearRampToValueAtTime(0.0001, t0 + 5.2);
      osc.connect(env);
      env.connect(lpf);
      osc.start(t0 + onset);
      osc.stop(t0 + 5.4);
      osc.onended = () => { osc.disconnect(); env.disconnect(); };
    });

    // Sub-bass pad: enters at 1.2s, stays through transition
    const sub = ctx.createOscillator();
    const subEnv = ctx.createGain();
    sub.type = "sine";
    sub.frequency.value = 73.42; // D2
    subEnv.gain.setValueAtTime(0.0001, t0 + 1.2);
    subEnv.gain.linearRampToValueAtTime(0.06, t0 + 2.8);
    subEnv.gain.linearRampToValueAtTime(0.0001, t0 + 5.3);
    sub.connect(subEnv);
    subEnv.connect(dry);
    sub.start(t0 + 1.2);
    sub.stop(t0 + 5.4);
    sub.onended = () => { sub.disconnect(); subEnv.disconnect(); };

    // High shimmer: a subtle triangle at the top
    const shimmer = ctx.createOscillator();
    const shimEnv = ctx.createGain();
    shimmer.type = "triangle";
    shimmer.frequency.setValueAtTime(1760, t0);
    shimmer.frequency.exponentialRampToValueAtTime(2093, t0 + 3.0);
    shimEnv.gain.setValueAtTime(0.0001, t0 + 1.8);
    shimEnv.gain.linearRampToValueAtTime(0.012, t0 + 3.0);
    shimEnv.gain.linearRampToValueAtTime(0.0001, t0 + 5.0);
    shimmer.connect(shimEnv);
    shimEnv.connect(lpf);
    shimmer.start(t0 + 1.8);
    shimmer.stop(t0 + 5.1);
    shimmer.onended = () => { shimmer.disconnect(); shimEnv.disconnect(); };

    // Cleanup reverb after boot completes
    setTimeout(() => { try { reverb.disconnect(); reverbGain.disconnect(); dry.disconnect(); lpf.disconnect(); } catch {} }, 6000);
  }

  startBoot() {
    this.unlock();
    this.phase = "boot";
    const generation = ++this.bootGeneration;
    this.bootSource?.stop();
    this.homeSource?.stop();
    this.bootSource = this.homeSource = null;
    this.stopSynthHome();
    this.stopFileMusic();
    this.bootStartedAt = this.context?.currentTime ?? 0;
    ramp(this.homeGain, 0, 0.02, this.context);
    if (window.location.protocol === "file:") {
      if (this.preferences.music) {
        if (hasOptionalAsset(SLOTS.boot[0])) this.playFileMusic("boot", 0.25);
        else this.synthBoot();
      }
      return;
    }
    void this.load("home");
    void this.load("boot").then((buffer) => {
      if (this.phase !== "boot" || generation !== this.bootGeneration) return;
      if (!this.context || !this.bootGain) return;
      if (!buffer) { this.synthBoot(); return; }
      const offset = Math.max(0, this.context.currentTime - this.bootStartedAt);
      if (offset >= buffer.duration) return;
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.bootGain);
      source.start(0, offset);
      this.bootSource = source;
      ramp(this.bootGain, 1, 0.25, this.context);
      source.onended = () => { if (this.bootSource === source) this.bootSource = null; source.disconnect(); };
    });
  }

  /** Called at 4.8 s, or immediately when the user skips. */
  crossfadeHome(seconds = 1.4) {
    this.phase = "home";
    this.bootGeneration++;
    ramp(this.bootGain, 0, seconds, this.context);
    if (this.bootSource && this.context) {
      try { this.bootSource.stop(this.context.currentTime + seconds + 0.03); } catch { /* already stopped */ }
    }
    this.fadeMedia("boot", 0, seconds, true);
    if (this.preferences.music && this.unlocked) this.ensureHome(seconds);
  }

  /** Gentle fade-out and a soft low tone, like the PS3 powering down. */
  startShutdown() {
    const ctx = this.context;
    if (!ctx || !this.unlocked) return;
    // Fade all music and effects
    ramp(this.music, 0, 1.2, ctx);
    ramp(this.effects, 0, 0.8, ctx);
    // A descending tone
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 1.4);
    env.gain.setValueAtTime(0.08, ctx.currentTime);
    env.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 1.4);
    osc.connect(env);
    if (this.master) env.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 1.5);
    osc.onended = () => { osc.disconnect(); env.disconnect(); };
  }

  /** Restore music after a shutdown is cancelled or the boot replays. */
  restoreAudio() {
    ramp(this.music, this.preferences.music ? (this.inApp ? 0.25 : 1) : 0, 0.3, this.context);
    ramp(this.effects, this.preferences.effects ? 1 : 0, 0.2, this.context);
  }

  private ensureHome(fade = 0.8) {
    if (this.phase !== "home" || !this.unlocked) return;
    if (window.location.protocol === "file:") {
      if (!SLOTS.home.some(hasOptionalAsset)) { this.startSynthHome(fade); return; }
      if (!this.media.home) this.playFileMusic("home", fade);
      else this.fadeMedia("home", 1, fade);
      return;
    }
    if (this.homeSource || this.synthHome) { ramp(this.homeGain, 1, fade, this.context); return; }
    void this.load("home").then((buffer) => {
      if (this.phase !== "home" || this.homeSource || this.synthHome || !this.context || !this.homeGain) return;
      if (!buffer) { this.startSynthHome(fade); return; }
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(this.homeGain);
      this.homeSource = source;
      source.start();
      ramp(this.homeGain, 1, fade, this.context);
      source.onended = () => { if (this.homeSource === source) this.homeSource = null; source.disconnect(); };
    });
  }

  setInApp(inApp: boolean) {
    this.inApp = inApp;
    this.updateMusicLevel();
    this.updateMediaVolumes();
  }

  private updateMusicLevel() {
    ramp(this.music, this.preferences.music ? (this.inApp ? 0.25 : 1) : 0, 0.55, this.context);
  }

  private updateMediaVolumes() {
    for (const slot of ["boot", "home"] as const) {
      const element = this.media[slot];
      if (element) element.volume = Math.max(0, Math.min(1,
        this.mediaLevel[slot] * this.preferences.master * (this.preferences.music ? (this.inApp ? 0.25 : 1) : 0)));
    }
  }

  private fadeMedia(slot: "boot" | "home", to: number, seconds: number, stop = false) {
    const element = this.media[slot];
    if (!element) return;
    cancelAnimationFrame(this.mediaFrames[slot] ?? 0);
    const from = this.mediaLevel[slot];
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / Math.max(10, seconds * 1000));
      this.mediaLevel[slot] = from + (to - from) * t;
      this.updateMediaVolumes();
      if (t < 1) this.mediaFrames[slot] = requestAnimationFrame(tick);
      else if (stop && this.media[slot] === element) { element.pause(); delete this.media[slot]; }
    };
    this.mediaFrames[slot] = requestAnimationFrame(tick);
  }

  private playFileMusic(slot: "boot" | "home", fade: number, index = 0) {
    if (!SLOTS[slot][index] || !this.unlocked) return;
    if (!hasOptionalAsset(SLOTS[slot][index])) {
      if (SLOTS[slot][index + 1]) this.playFileMusic(slot, fade, index + 1);
      return;
    }
    const element = new Audio(publicAsset(SLOTS[slot][index]));
    element.loop = slot === "home";
    element.preload = "auto";
    element.volume = 0;
    this.media[slot] = element;
    this.mediaLevel[slot] = 0;
    element.addEventListener("error", () => {
      if (this.media[slot] !== element) return;
      delete this.media[slot];
      if (SLOTS[slot][index + 1]) this.playFileMusic(slot, fade, index + 1);
    }, { once: true });
    void element.play().then(() => this.fadeMedia(slot, 1, fade)).catch(() => {});
  }

  private playFileEffect(slot: SoundEffect) {
    if (!hasOptionalAsset(SLOTS[slot][0])) return;
    const element = new Audio(publicAsset(SLOTS[slot][0]));
    element.volume = this.preferences.master;
    void element.play().catch(() => {});
  }

  private stopFileMusic() {
    for (const slot of ["boot", "home"] as const) {
      cancelAnimationFrame(this.mediaFrames[slot] ?? 0);
      this.media[slot]?.pause();
      delete this.media[slot];
      this.mediaLevel[slot] = 0;
    }
  }

  pauseForVisibility() {
    if (!this.unlocked) return;
    if (document.hidden) {
      if (this.context?.state === "running") void this.context.suspend().catch(() => {});
      this.media.boot?.pause();
      this.media.home?.pause();
    } else {
      if (this.context?.state === "suspended") void this.context.resume().catch(() => {});
      if (this.phase === "boot" && this.media.boot && this.preferences.music) void this.media.boot.play().catch(() => {});
      if (this.phase === "home" && this.media.home && this.preferences.music) void this.media.home.play().catch(() => {});
    }
  }
}

export const xmbAudio = new XmbAudio();
export const blip = (kind: SoundEffect = "move") => xmbAudio.blip(kind);
