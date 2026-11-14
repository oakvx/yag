import { assetExists, hasOptionalAsset, publicAsset } from "./assets";

export type SoundEffect = "move" | "select" | "back" | "category" | "trophy";
export interface AudioPreferences { music: boolean; effects: boolean; master: number }

const STORAGE_KEY = "yag-xmb-audio-v2";
/** Exposed so the profile page can report where the audio preferences live. */
export const AUDIO_STORAGE_KEY = STORAGE_KEY;

const DEFAULTS: AudioPreferences = { music: true, effects: true, master: 0.6 };
const SLOTS: Record<"boot" | "home" | SoundEffect, string[]> = {
  boot: ["audio/start.mp3"],
  home: ["xmb-home.mp3", "xmb-home.ogg"],
  move: ["audio/cursor.mp3"],
  select: ["audio/select.mp3"],
  back: ["audio/cancel.mp3"],
  category: ["audio/cursor.mp3"],
  trophy: ["audio/trophy.mp3"],
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
    this.playFileEffect(kind);
  }

  startBoot() {
    this.unlock();
    this.phase = "boot";
    const generation = ++this.bootGeneration;
    this.bootSource?.stop();
    this.homeSource?.stop();
    this.bootSource = this.homeSource = null;
    this.stopFileMusic();
    this.bootStartedAt = this.context?.currentTime ?? 0;
    ramp(this.homeGain, 0, 0.02, this.context);
    if (window.location.protocol === "file:") {
      if (this.preferences.music) this.playFileMusic("boot", 0.25);
      return;
    }
    void this.load("home");
    void this.load("boot").then((buffer) => {
      if (this.phase !== "boot" || generation !== this.bootGeneration) return;
      if (!buffer || !this.context || !this.bootGain) return;
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

  private ensureHome(fade = 0.8) {
    if (this.phase !== "home" || !this.unlocked) return;
    if (window.location.protocol === "file:") {
      if (!this.media.home) this.playFileMusic("home", fade);
      else this.fadeMedia("home", 1, fade);
      return;
    }
    if (this.homeSource) { ramp(this.homeGain, 1, fade, this.context); return; }
    void this.load("home").then((buffer) => {
      if (this.phase !== "home" || this.homeSource || !buffer || !this.context || !this.homeGain) return;
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
