import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { xmbAudio } from "./audio";
import { assetExists, publicAsset } from "./assets";
import { useBrandFont } from "./brandFont";
import {
  BOOT_DURATION, BOOT_HANDOFF, BOOT_SKIP_DURATION, REDUCED_BOOT_DURATION, REDUCED_BOOT_HANDOFF,
  getBootFrame, hasSeenBoot, rememberBoot, type BootClock, type BootStage,
} from "./bootState";

const wakeWallpaper = () => window.dispatchEvent(new Event("yag:boot"));

export function useBootSequence() {
  const [stage, setStage] = useState<BootStage>(() => hasSeenBoot() ? "home" : "gate");
  const [paused, setPaused] = useState(() => document.hidden);
  const [skipping, setSkipping] = useState(false);
  const clock = useRef<BootClock>({
    stage,
    elapsed: 0,
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  });

  const start = useCallback(() => {
    if (clock.current.stage !== "gate" && clock.current.stage !== "playing") return;
    xmbAudio.startBoot();
    rememberBoot();
    clock.current.elapsed = 0;
    clock.current.skip = undefined;
    clock.current.stage = "playing";
    setSkipping(false);
    setStage("playing");
    wakeWallpaper();
  }, []);

  // Start the visual boot automatically. Browsers may still block the audio
  // until the first user gesture, but the site itself never waits for one.
  useEffect(() => {
    if (clock.current.stage === "gate") start();
  }, [start]);

  const skip = useCallback(() => {
    if (clock.current.elapsed < 1 || clock.current.stage === "home") return;
    if (clock.current.skip) return;
    const from = getBootFrame(clock.current);
    clock.current.skip = { at: clock.current.elapsed, from };
    clock.current.stage = "handoff";
    setSkipping(true);
    setStage("handoff");
    xmbAudio.crossfadeHome(BOOT_SKIP_DURATION);
    wakeWallpaper();
  }, []);

  const replay = useCallback(() => {
    // This is itself a user gesture; do not require the gate a second time.
    xmbAudio.startBoot();
    clock.current.elapsed = 0;
    clock.current.skip = undefined;
    clock.current.stage = "playing";
    setSkipping(false);
    setStage("playing");
    wakeWallpaper();
  }, []);

  const running = stage === "playing" || stage === "handoff";
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last = performance.now();
    let handedOff = clock.current.stage === "handoff";
    const visible = () => { last = performance.now(); };
    const advance = (now: number) => {
      if (clock.current.stage === "home" || clock.current.stage === "gate") return false;
      if (!document.hidden) clock.current.elapsed += Math.max(0, now - last) / 1000;
      last = Math.max(last, now);
      const handoff = clock.current.reduced ? REDUCED_BOOT_HANDOFF : BOOT_HANDOFF;
      const duration = clock.current.reduced ? REDUCED_BOOT_DURATION : BOOT_DURATION;
      if (clock.current.skip) {
        if (clock.current.elapsed - clock.current.skip.at < BOOT_SKIP_DURATION) return true;
        clock.current.stage = "home";
        clock.current.skip = undefined;
        setSkipping(false);
        setStage("home");
        wakeWallpaper();
        return false;
      }
      if (!handedOff && clock.current.elapsed >= handoff) {
        handedOff = true;
        clock.current.stage = "handoff";
        setStage("handoff");
        xmbAudio.crossfadeHome(duration - handoff);
        wakeWallpaper();
      }
      if (clock.current.elapsed >= duration) {
        clock.current.stage = "home";
        setStage("home");
        wakeWallpaper();
        return false;
      }
      return true;
    };
    const tick = (now: number) => { if (advance(now)) frame = requestAnimationFrame(tick); };
    // A timer also advances milestones if the compositor temporarily stalls RAF.
    const watchdog = window.setInterval(() => { advance(performance.now()); }, 50);
    document.addEventListener("visibilitychange", visible);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(watchdog);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [running]);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => { clock.current.reduced = motion.matches; wakeWallpaper(); };
    const visibility = () => { setPaused(document.hidden); xmbAudio.pauseForVisibility(); };
    motion.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      motion.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  // Keep the boot visual automatic, while using the first available gesture
  // to satisfy browser autoplay policies and resume the startup audio.
  useEffect(() => {
    if (stage !== "playing" && stage !== "handoff") return;
    const unlock = () => xmbAudio.unlock();
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, [stage]);

  useEffect(() => {
    if (stage !== "home") return;
    // After a reload in the same session, resume the ambient only after a fresh gesture.
    xmbAudio.crossfadeHome(0.6);
    const unlock = () => xmbAudio.unlock();
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, [stage]);

  return { stage, paused, skipping, clock, start, skip, replay };
}

interface BootScreenProps {
  stage: BootStage;
  paused: boolean;
  skipping: boolean;
  clock: RefObject<BootClock>;
  onStart: () => void;
  onSkip: () => void;
}

export function BootScreen({ stage, paused, skipping, clock, onStart, onSkip }: BootScreenProps) {
  const [logo, setLogo] = useState(false);
  const [subtitle, setSubtitle] = useState(false);
  const brandFont = useBrandFont();
  const startButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let mounted = true;
    void assetExists("brand/boot-logo.svg", "image").then((ok) => { if (mounted) setLogo(ok); });
    void assetExists("brand/boot-subtitle.svg", "image").then((ok) => { if (mounted) setSubtitle(ok); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (stage === "gate") startButton.current?.focus({ preventScroll: true });
    if (stage === "home") return;
    const gesture = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent && event.repeat) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (clock.current.stage === "gate") onStart();
      else if (clock.current.elapsed >= 1) onSkip();
    };
    window.addEventListener("keydown", gesture, true);
    window.addEventListener("pointerdown", gesture, true);
    return () => {
      window.removeEventListener("keydown", gesture, true);
      window.removeEventListener("pointerdown", gesture, true);
    };
  }, [clock, onSkip, onStart, stage]);

  if (stage === "home") return null;
  return (
    <div
      className="boot-screen"
      data-running={stage !== "gate"}
      data-paused={paused}
      data-skipping={skipping}
      role={stage === "gate" ? "dialog" : undefined}
      aria-modal={stage === "gate" ? true : undefined}
      aria-label={stage === "gate" ? "Start YAG" : undefined}
      aria-live="off"
    >
      {stage === "gate" ? (
        <button ref={startButton} type="button" className="boot-gate" onClick={onStart}>
          Press a key or click to start
          <span>Audio starts after the interaction.</span>
        </button>
      ) : (
        <>
        <p className="sr-only" role="status">YAG is starting. Press a key or click to skip after one second.</p>
        <div className="boot-brand" aria-hidden="true">
          <div className="boot-wordmark">
            {brandFont ? (
              <span className="boot-wordmark-text" style={{ fontFamily: brandFont }}>YAG</span>
            ) : logo ? (
              <img src={publicAsset("brand/boot-logo.svg")} alt="" onError={() => setLogo(false)} />
            ) : (
              <svg viewBox="0 0 510 112" role="presentation" focusable="false">
                <path d="M8 12h32l40 44 40-44h32L94 77v28H66V77z" />
                <path d="M169 105 222 12h27l54 93h-31l-10-19h-53l-10 19zm52-42h29l-14-27z" />
                <path d="M352 12h113v23H355c-15 0-23 8-23 23s8 23 23 23h82V69h-55V48h83v57H352c-33 0-50-19-50-47s17-46 50-46z" />
              </svg>
            )}
          </div>
          <div className="boot-subtitle">
            {subtitle ? (
              <img src={publicAsset("brand/boot-subtitle.svg")} alt="" onError={() => setSubtitle(false)} />
            ) : "Yet Another Gateway"}
          </div>
        </div>
        </>
      )}
    </div>
  );
}
