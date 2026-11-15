import { useCallback, useEffect, useRef, useState } from "react";

/** Hide the menu hints after five seconds, without consuming the wake-up input. */
export function useIdleChrome(enabled: boolean) {
  const [idle, setIdle] = useState(false);
  const [keyboardMode, setKeyboardMode] = useState(false);
  const inputMode = useRef(false);
  const timer = useRef(0);
  const lastWake = useRef(-Infinity);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const wake = useCallback((event?: Event) => {
    if (!enabledRef.current) return;
    const keyboard = event?.type === "keydown";
    if (inputMode.current !== keyboard) {
      inputMode.current = keyboard;
      setKeyboardMode(keyboard);
    }
    const now = performance.now();
    // Pointer/gamepad repeats do not need a React update on every frame.
    if (now - lastWake.current < 100) return;
    lastWake.current = now;
    setIdle(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setIdle(true), 5000);
  }, []);
  useEffect(() => {
    if (!enabled) { window.clearTimeout(timer.current); return; }
    lastWake.current = -Infinity;
    wake();
    const events = ["keydown", "pointerdown", "pointermove", "wheel"] as const;
    for (const event of events) window.addEventListener(event, wake, { passive: true, capture: true });
    return () => {
      window.clearTimeout(timer.current);
      for (const event of events) window.removeEventListener(event, wake, true);
    };
  }, [enabled, wake]);
  return { idle: enabled && idle, keyboardMode, wake };
}
