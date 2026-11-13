import { useEffect, useRef } from "react";
import { ConsoleIcon } from "./ConsoleIcons";
import { YagEmblem } from "./Glyphs";

const PHRASE = "gateway";
interface EasterEggProps { open: boolean; onClose: () => void }

/** Hidden service mode: type "gateway", enter the Konami code, or tap the wordmark five times. */
export function EasterEgg({ open, onClose }: EasterEggProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape" || event.key === "Backspace") { event.preventDefault(); onClose(); }
      if (event.key === "Tab") {
        const focusable = [closeRef.current, returnRef.current].filter(Boolean) as HTMLElement[];
        const index = focusable.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        const next = event.shiftKey
          ? focusable[(index - 1 + focusable.length) % focusable.length]
          : focusable[(index + 1) % focusable.length];
        next?.focus();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="easter-backdrop" onPointerDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="easter-title" className="easter-panel" onPointerDown={(event) => event.stopPropagation()}>
        <div className="easter-head">
          <YagEmblem size={28} />
          <div><p>Service Mode / build 2006</p><h2 id="easter-title">YAG does not think.</h2></div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close service mode">o</button>
        </div>
        <p className="easter-quote">It decides who gets to ask.</p>
        <div className="easter-grid">
          <span><ConsoleIcon name="gateway" /> Router</span>
          <span><ConsoleIcon name="protocol" /> Translator</span>
          <span><ConsoleIcon name="shield" /> Gatekeeper</span>
          <span><ConsoleIcon name="status" /> Never a model runtime</span>
        </div>
        <p className="easter-note">A hidden nod to the spatial menu language of 2006. The interface, icons and motion are original work. No Sony artwork, fonts or sounds are included.</p>
        <div className="easter-actions">
          <span>Try the Konami code next time.</span>
          <button ref={returnRef} type="button" onClick={onClose}>Return to the menu</button>
        </div>
      </section>
    </div>
  );
}

/** Passive detector: never prevents typing or normal menu navigation. */
export function useEasterEgg(onOpen: () => void) {
  const progress = useRef(0);
  // Keep the callback in a ref so menu re-renders cannot reset the sequence.
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => {
    const reset = () => { progress.current = 0; };
    const konami = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight"];
    const kprogress = { value: 0 };
    const key = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select") || target?.isContentEditable) return;
      if (event.key.length === 1) {
        if (event.key.toLowerCase() === PHRASE[progress.current]) {
          progress.current++;
          if (progress.current === PHRASE.length) { progress.current = 0; openRef.current(); }
          return;
        }
        progress.current = event.key.toLowerCase() === PHRASE[0] ? 1 : 0;
      }
      if (event.key === konami[kprogress.value]) {
        kprogress.value++;
        if (kprogress.value === konami.length) { kprogress.value = 0; openRef.current(); }
      } else kprogress.value = event.key === konami[0] ? 1 : 0;
    };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", reset, { passive: true });
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", reset);
    };
  }, []);
}
