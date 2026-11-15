import { useEffect, useState, type ReactNode, type RefObject } from "react";

type FocusableElement = HTMLElement | SVGElement;
const focusable = (root: HTMLElement) => [...root.querySelectorAll<FocusableElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [role=button][tabindex], [tabindex='0']")]
  .filter((el) => !el.closest("[inert], [hidden]") && el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
const previousFocus = new WeakMap<HTMLElement, FocusableElement>();

/** Route controller input through the same controls the keyboard operates. */
export function sendApplicationInput(root: HTMLElement | null, key: string) {
  if (!root || root.closest("[inert]")) return;
  const stored = previousFocus.get(root);
  const focused = document.activeElement;
  const active = (focused instanceof HTMLElement || focused instanceof SVGElement) && root.contains(focused) ? focused
    : stored?.isConnected && root.contains(stored) ? stored : null;
  const list = root.querySelector<HTMLElement>(".xmb-list");
  const target = active && active !== root ? active : list?.querySelector<HTMLElement>(".is-selected .xmb-list-link") ?? null;
  if (key === "Escape") return (target ?? root).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  if (active instanceof HTMLSelectElement && (key === "ArrowUp" || key === "ArrowDown")) {
    active.selectedIndex = Math.max(0, Math.min(active.options.length - 1, active.selectedIndex + (key === "ArrowDown" ? 1 : -1)));
    active.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (key === "PageUp" || key === "PageDown") {
    (target ?? root).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    return;
  }
  if (key === "Enter") {
    if (target instanceof HTMLElement) target.click();
    else target?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return;
  }
  // Let the screen handle its row field, choices and detail focus identically
  // for physical keys and synthetic controller events.
  if (active?.closest(".xmb-screen")) {
    if (!active.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))) return;
  }
  if (list && (!active || active === root || list.contains(active))) {
    const row = target ?? list;
    row.focus({ preventScroll: true });
    row.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    return;
  }
  if (active && !active.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))) return;
  if (active instanceof HTMLInputElement && active.type === "range" && (key === "ArrowLeft" || key === "ArrowRight")) {
    const value = Number(active.value) + (key === "ArrowRight" ? 1 : -1) * Number(active.step || 1);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(active, String(Math.max(Number(active.min || 0), Math.min(Number(active.max || 100), value))));
    active.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  const controls = focusable(root);
  const index = active ? controls.indexOf(active) : -1;
  const direction = key === "ArrowUp" || key === "ArrowLeft" ? -1 : 1;
  controls[Math.max(0, Math.min(controls.length - 1, index + direction))]?.focus();
}

export function ApplicationHints({ rootRef, onBack, backGlyph, selectGlyph, navigateGlyph }: {
  rootRef: RefObject<HTMLElement | null>;
  onBack: () => void;
  backGlyph: ReactNode;
  selectGlyph: ReactNode;
  navigateGlyph: ReactNode;
}) {
  const [selectable, setSelectable] = useState(false);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const update = () => {
      const screen = root.querySelector<HTMLElement>(".xmb-screen");
      setSelectable(screen ? screen.dataset.selectable === "true" : focusable(root).some((el) => el.matches("button, a, input, select")));
    };
    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-selectable"] });
    update();
    const focus = (e: FocusEvent) => { if (e.target instanceof HTMLElement || e.target instanceof SVGElement) previousFocus.set(root, e.target); };
    root.addEventListener("focusin", focus);
    const sections = (e: KeyboardEvent) => {
      if (e.defaultPrevented || root.querySelector(".xmb-screen") || root.closest("[inert]") || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== "PageUp" && e.key !== "PageDown") return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable=true]")) return;
      const targets = [...root.querySelectorAll<HTMLElement>("section")];
      if (!targets.length) return;
      const top = root.getBoundingClientRect().top;
      const next = e.key === "PageDown" ? targets.find((el) => el.getBoundingClientRect().top > top + 24)
        : targets.slice().reverse().find((el) => el.getBoundingClientRect().top < top - 24);
      if (next) { e.preventDefault(); root.scrollBy({ top: next.getBoundingClientRect().top - top }); }
    };
    window.addEventListener("keydown", sections);
    return () => { observer.disconnect(); root.removeEventListener("focusin", focus); window.removeEventListener("keydown", sections); };
  }, [rootRef]);
  return <nav className="console-app-hints" aria-label="Page controls">
    <button type="button" onClick={onBack}>{backGlyph}<span>Back</span></button>
    {selectable && <button type="button" onClick={() => sendApplicationInput(rootRef.current, "Enter")}>{selectGlyph}<span>Select</span></button>}
    <button type="button" onClick={() => sendApplicationInput(rootRef.current, "ArrowDown")}>{navigateGlyph}<span>Navigate</span></button>
  </nav>;
}
