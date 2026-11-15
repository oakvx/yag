import { useRef, type TouchEvent, type WheelEvent } from "react";

export type DpadDirection = "up" | "down" | "left" | "right";

/** One deliberate wheel/swipe gesture produces one menu step. */
export function useDpadNavigation(enabled: boolean, onStep: (direction: DpadDirection) => void) {
  const wheel = useRef({ x: 0, y: 0, last: 0, lockedUntil: 0, lastMag: 0 });
  const touch = useRef<{ x: number; y: number } | null>(null);
  const swipeAt = useRef(-Infinity);
  return {
    suppressClick: () => performance.now() - swipeAt.current < 350,
    onWheel: (event: WheelEvent<HTMLElement>) => {
      if (!enabled || event.ctrlKey || event.metaKey) return;
      const now = performance.now();
      const state = wheel.current;
      if (now - state.last > 160) { state.x = 0; state.y = 0; }
      state.last = now;
      const unit = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? window.innerHeight : 1;
      const magnitude = Math.max(Math.abs(event.deltaX), Math.abs(event.deltaY)) * unit;
      if (now < state.lockedUntil) {
        if (magnitude < state.lastMag * 0.98 || magnitude < 4) state.lockedUntil = now + 260;
        state.lastMag = magnitude;
        return;
      }
      state.lastMag = magnitude;
      state.x += event.deltaX * unit;
      state.y += event.deltaY * unit;
      const horizontal = Math.abs(state.x) > Math.abs(state.y);
      const amount = horizontal ? state.x : state.y;
      if (Math.abs(amount) < 70) return;
      state.x = state.y = 0;
      state.lockedUntil = now + 260;
      onStep(horizontal ? amount > 0 ? "right" : "left" : amount > 0 ? "down" : "up");
    },
    onTouchStart: (event: TouchEvent<HTMLElement>) => {
      if (enabled && event.touches.length === 1) swipeAt.current = -Infinity;
      touch.current = enabled && event.touches.length === 1
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
    },
    onTouchCancel: () => { touch.current = null; },
    onTouchEnd: (event: TouchEvent<HTMLElement>) => {
      const start = touch.current;
      touch.current = null;
      if (!enabled || !start || event.touches.length || !event.changedTouches.length) return;
      const dx = event.changedTouches[0].clientX - start.x;
      const dy = event.changedTouches[0].clientY - start.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 44) return;
      swipeAt.current = performance.now();
      onStep(Math.abs(dx) > Math.abs(dy) ? dx < 0 ? "right" : "left" : dy < 0 ? "down" : "up");
    },
  };
}
