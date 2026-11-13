export const BOOT_DURATION = 6.2;
export const BOOT_HANDOFF = 4.8;
export const REDUCED_BOOT_DURATION = 2.2;
export const REDUCED_BOOT_HANDOFF = 1.65;
export const BOOT_SKIP_DURATION = 0.35;

export type BootStage = "gate" | "playing" | "handoff" | "home";

/** Shared mutable clock: the shader reads it without rendering React every frame. */
export interface BootClock {
  stage: BootStage;
  elapsed: number;
  reduced: boolean;
  skip?: { at: number; from: { boot: number; progress: number; exposure: number } };
}

export const BOOT_SESSION_KEY = "yag-xmb-boot-seen";

export function hasSeenBoot(): boolean {
  try {
    return sessionStorage.getItem(BOOT_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberBoot(): void {
  try {
    sessionStorage.setItem(BOOT_SESSION_KEY, "1");
  } catch {
    // The experience still works without persistent storage.
  }
}

export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export const smooth = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

export interface WaveFrame {
  time: number;
  progress: number;
  boot: number;
  exposure: number;
  brightness: number;
  swell: number;
  swellPosition: number;
  palette: Float32Array;
}

export function getBootFrame(clock: BootClock) {
  if (clock.stage === "gate") return { boot: 1, progress: 0, exposure: 0 };
  if (clock.stage === "home") return { boot: 0, progress: 1, exposure: 1 };
  if (clock.skip) {
    const t = smooth((clock.elapsed - clock.skip.at) / BOOT_SKIP_DURATION);
    return {
      boot: clock.skip.from.boot * (1 - t),
      progress: clock.skip.from.progress + (1 - clock.skip.from.progress) * t,
      exposure: clock.skip.from.exposure + (1 - clock.skip.from.exposure) * t,
    };
  }
  if (clock.reduced) {
    return {
      boot: 1 - smooth((clock.elapsed - REDUCED_BOOT_HANDOFF) / (REDUCED_BOOT_DURATION - REDUCED_BOOT_HANDOFF)),
      progress: 0,
      exposure: smooth((clock.elapsed - 0.22) / 0.35),
    };
  }
  const reveal = clamp01((clock.elapsed - 0.7) / 1.9);
  return {
    boot: 1 - smooth((clock.elapsed - BOOT_HANDOFF) / (BOOT_DURATION - BOOT_HANDOFF)),
    progress: 1 - Math.pow(1 - reveal, 3),
    exposure: smooth((clock.elapsed - 0.7) / 0.38),
  };
}