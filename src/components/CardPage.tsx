import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { blip } from "@/xmb/audio";

const HINT = "Up / Down to select · Enter to open";

export const CardPageInfoContext = createContext<((info: string) => void) | null>(null);

function describe(element: HTMLElement) {
  if (element.dataset.info) return element.dataset.info;
  const key = element.querySelector(".xmb-row-key, .xmb-tile-title")?.textContent?.trim();
  const value = element.querySelector(".xmb-row-value, .xmb-tile-sub")?.textContent?.trim();
  if (key && value) return `${key}: ${value}`;
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Card pages behave like a console settings screen: rows and links are one
 * cursor column (Up / Down, with the menu's move sound) and the line at the
 * bottom explains whatever the cursor is on.
 */
export function CardPage({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const publishInfo = useContext(CardPageInfoContext);
  const [info, setInfo] = useState(HINT);

  useEffect(() => {
    const page = root.current;
    if (!page) return;
    const updateInfo = (value: string) => {
      setInfo(value);
      publishInfo?.(value);
    };
    page.querySelectorAll<HTMLElement>("a.btn").forEach((link) => { link.dataset.cursor = ""; });
    updateInfo(HINT);

    const items = () => [...page.querySelectorAll<HTMLElement>("[data-cursor]")].filter((el) => el.getClientRects().length);
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const active = document.activeElement as HTMLElement | null;
      const main = page.closest<HTMLElement>("#main-content");
      const current = active?.closest<HTMLElement>("[data-cursor]");
      const inside = !!current && page.contains(current);
      if (!inside && active !== main) return;
      const list = items();
      if (!list.length) return;
      const down = event.key === "ArrowDown";
      const index = inside ? list.indexOf(current) : -1;
      const next = index < 0 ? (down ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, index + (down ? 1 : -1)));
      event.preventDefault();
      if (next === index) { if (!down) main?.scrollTo({ top: 0, behavior: "smooth" }); return; }
      list[next].focus({ preventScroll: true });
      if (main) {
        const box = main.getBoundingClientRect();
        const row = list[next].getBoundingClientRect();
        if (row.top < box.top + 48 || row.bottom > box.bottom - 80) {
          main.scrollBy({ top: row.top - (box.top + box.height / 2) + row.height / 2, behavior: "smooth" });
        }
      }
      blip("move");
    };
    const focus = (event: FocusEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-cursor]");
      if (target) updateInfo(describe(target));
    };
    const blur = (event: FocusEvent) => {
      if (!page.contains(event.relatedTarget as Node | null)) updateInfo(HINT);
    };
    const hover = (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-cursor]");
      if (target) updateInfo(describe(target));
    };
    window.addEventListener("keydown", key);
    page.addEventListener("focusin", focus);
    page.addEventListener("focusout", blur);
    page.addEventListener("mouseover", hover);
    return () => {
      window.removeEventListener("keydown", key);
      page.removeEventListener("focusin", focus);
      page.removeEventListener("focusout", blur);
      page.removeEventListener("mouseover", hover);
      publishInfo?.("");
    };
  }, [publishInfo]);

  return <div ref={root} className="xmb-card-page">
    {children}
    {!publishInfo && <p className="xmb-info-line xmb-card-info" aria-live="polite" aria-atomic="true">{info.length > 140 ? `${info.slice(0, 137)}…` : info}</p>}
  </div>;
}
