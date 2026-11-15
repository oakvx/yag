import { useEffect, useRef } from "react";

export type GamepadButton =
  | "cross"
  | "circle"
  | "triangle"
  | "l1"
  | "r1"
  | "dpadUp"
  | "dpadDown"
  | "dpadLeft"
  | "dpadRight";

/** The standard pad layout the console understands, by button index. */
const STANDARD: ReadonlyArray<readonly [GamepadButton, number]> = [
  ["cross", 0],
  ["circle", 1],
  ["triangle", 3],
  ["l1", 4],
  ["r1", 5],
  ["dpadUp", 12],
  ["dpadDown", 13],
  ["dpadLeft", 14],
  ["dpadRight", 15],
];

/** How long a held button pauses before it starts stepping again. */
const REPEAT_DELAY = 480;
/** How often a held button steps once the pause is over. */
const REPEAT_INTERVAL = 120;

export interface GamepadActions {
  /** The console is ready to take pad input (boot done, no palette). */
  enabled(): boolean;
  onStep(axis: "up" | "down" | "left" | "right"): void;
  onSelect(): void;
  onBack(): void;
  onOptions(): void;
}

interface Hold {
  since: number;
  last: number;
}

/**
 * Polls the first connected gamepad once per frame and maps the standard
 * layout onto the console's verbs: the D-pad moves, L1/R1 step between
 * categories, ✕ selects, ○ returns, △ opens the options.
 *
 * A press is one step. Holding a button takes the first step immediately,
 * pauses, then steps at a fast constant rate — one input, one step, as
 * with the hardware's D-pad. All state lives in refs, so the loop never
 * re-renders the console, and cleanup removes the listeners and the frame
 * loop when the console unmounts.
 */
export function useGamepad(actions: GamepadActions): void {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    let raf = 0;
    let running = true;
    const holds = new Map<number, Hold>();

    const step = (name: GamepadButton) => {
      const current = actionsRef.current;
      if (!current.enabled()) return;
      switch (name) {
        case "dpadUp":
          current.onStep("up");
          break;
        case "dpadDown":
          current.onStep("down");
          break;
        case "dpadLeft":
          current.onStep("left");
          break;
        case "dpadRight":
          current.onStep("right");
          break;
        case "l1":
          current.onStep("left");
          break;
        case "r1":
          current.onStep("right");
          break;
        case "cross":
          current.onSelect();
          break;
        case "circle":
          current.onBack();
          break;
        case "triangle":
          current.onOptions();
          break;
      }
    };

    const poll = () => {
      if (!running) return;
      const now = performance.now();
      const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : [];
      let pad: Gamepad | null = null;
      for (const candidate of pads) {
        if (candidate && candidate.connected) {
          pad = candidate;
          break;
        }
      }
      if (pad) {
        for (const [name, index] of STANDARD) {
          const button = pad.buttons[index];
          const down = button ? button.pressed || button.value > 0.5 : false;
          const hold = holds.get(index);
          if (down) {
            if (!hold) {
              // Fresh press: one step, immediately.
              holds.set(index, { since: now, last: now });
              step(name);
            } else if (now - hold.since >= REPEAT_DELAY && now - hold.last >= REPEAT_INTERVAL) {
              // Held past the pause: fast, even steps.
              hold.last = now;
              step(name);
            }
          } else if (hold) {
            // Released: the hold is over, whatever the repeat state was.
            holds.delete(index);
          }
        }
      } else if (holds.size > 0) {
        holds.clear();
      }
      raf = requestAnimationFrame(poll);
    };

    // The poller picks newly connected pads up on its own frame; the events
    // only clear stale holds the moment a pad disappears.
    const connected = () => undefined;
    const disconnected = () => holds.clear();
    window.addEventListener("gamepadconnected", connected);
    window.addEventListener("gamepaddisconnected", disconnected);
    raf = requestAnimationFrame(poll);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      holds.clear();
      window.removeEventListener("gamepadconnected", connected);
      window.removeEventListener("gamepaddisconnected", disconnected);
    };
  }, []);
}
