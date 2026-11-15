import { useCallback, useEffect, useRef, useState } from "react";
import { blip, xmbAudio } from "./audio";

export type ShutdownPhase = "idle" | "fading" | "closing" | "off";

export function useShutdown() {
  const [phase, setPhase] = useState<ShutdownPhase>("idle");
  const timers = useRef<number[]>([]);

  const cancel = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    xmbAudio.restoreAudio();
    setPhase("idle");
  }, []);

  const start = useCallback(() => {
    if (phase !== "idle") return;
    blip("back");
    xmbAudio.startShutdown();
    setPhase("fading");

    // After 900ms, start the CRT collapse animation
    const t1 = window.setTimeout(() => {
      setPhase("closing");
      // After CRT collapse completes (600ms), screen is off
      const t2 = window.setTimeout(() => {
        setPhase("off");
      }, 650);
      timers.current.push(t2);
    }, 900);
    timers.current.push(t1);
  }, [phase]);

  useEffect(() => () => {
    timers.current.forEach((t) => window.clearTimeout(t));
  }, []);

  return { phase, start, cancel };
}

export function ShutdownOverlay({
  phase,
  onRestart,
}: {
  phase: ShutdownPhase;
  onRestart: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (phase === "off") {
      btnRef.current?.focus({ preventScroll: true });
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        onRestart();
      };
      window.addEventListener("keydown", onKey, { once: true });
      return () => window.removeEventListener("keydown", onKey);
    }
  }, [phase, onRestart]);

  if (phase === "idle") return null;

  return (
    <div
      className="shutdown-overlay"
      data-phase={phase}
      aria-hidden={phase !== "off"}
      role={phase === "off" ? "dialog" : undefined}
      aria-label={phase === "off" ? "Console is turned off" : undefined}
    >
      {phase === "off" && (
        <button
          ref={btnRef}
          type="button"
          className="shutdown-restart"
          onClick={onRestart}
          aria-label="Restart console"
        >
          <span className="shutdown-power-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
              <path d="M12 6v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <span className="shutdown-restart-label">Press to turn on</span>
        </button>
      )}
    </div>
  );
}
