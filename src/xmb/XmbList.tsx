import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { cn } from "@/utils/cn";
import { blip } from "./audio";
import { ConsoleIcon } from "./ConsoleIcons";
import type { GlyphName, ItemIcon } from "./categories";

export type XmbGlyph = GlyphName | ItemIcon;

/** One entry of the console's list, presented the way the hardware presents its own. */
export interface XmbListEntry {
  key: string;
  icon?: XmbGlyph;
  /** Two palette colors (top, bottom): drawn as a small swatch in the icon slot. */
  swatch?: readonly [string, string];
  /** Main line, cut with an ellipsis at the list's edge. */
  title: string;
  description?: string;
  /** Small second line inside the title (a merge's source branch, for instance). */
  sub?: string | null;
  /** Fixed right column, tabular, one line. */
  meta?: string | null;
  /** A full-width right value, wrapping: key/value rows of a Settings screen. */
  value?: string | null;
  /** Shown under the highlighted entry only. */
  detail?: ReactNode;
  /** The small bright "new" marker. */
  fresh?: boolean;
  /** When set, the entry is a link that opens in a new tab. */
  href?: string;
  to?: string;
  opensScreen?: boolean;
  ariaLabel?: string;
}

export interface XmbListProps {
  entries: XmbListEntry[];
  /** The keyboard cursor: the entry the list stays anchored on. */
  selected: number;
  ariaLabel: string;
  onSelect?: (index: number) => void;
  /** Enter or Space on the highlighted entry. */
  onActivate?: (index: number) => void;
  /** Reports the highlighted entry (keyboard cursor or hover). */
  onHighlight?: (index: number) => void;
  /** Focus the first entry once the list becomes visible (the board opens this way). */
  focusOnMount?: boolean;
  /** Page-sized rows: a smaller step and font than the full-screen board. */
  compact?: boolean;
  screen?: boolean;
  flow?: boolean;
  viewportRef?: RefObject<HTMLUListElement | null>;
  className?: string;
}

/**
 * The console's list: the behaviour the hardware gives its settings and
 * information screens. The highlighted entry stands on the list's centre
 * line, enlarged and fully opaque; the entries around it step away, shrink
 * and fade, with a continuous interpolation by distance. Arrow keys travel
 * the list, Home and End jump, Enter confirms; hovering moves only the
 * highlight, so the rows stay put under the pointer. A gradient mask keeps
 * the entries clear of the list's edges.
 */
export function XmbList({
  entries,
  selected,
  ariaLabel,
  onSelect,
  onActivate,
  onHighlight,
  focusOnMount = false,
  compact = false,
  screen = false,
  flow = false,
  viewportRef,
  className,
}: XmbListProps) {
  const rowRefs = useRef<Array<HTMLAnchorElement | HTMLButtonElement | null>>([]);
  const listRef = useRef<HTMLUListElement>(null);
  const centerRef = useRef<(() => void) | null>(null);
  const [hover, setHover] = useState<{ anchor: number; index: number } | null>(null);
  const highlighted = hover?.index ?? selected;

  const highlightRef = useRef(onHighlight);
  highlightRef.current = onHighlight;
  useEffect(() => {
    highlightRef.current?.(highlighted);
  }, [highlighted]);

  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const activateRef = useRef(onActivate);
  activateRef.current = onActivate;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useLayoutEffect(() => {
    if (!screen) return;
    const list = listRef.current;
    const row = rowRefs.current[selected]?.parentElement;
    if (!list || !row) return;
    const center = () => {
      if (flow) {
        list.dataset.long = "false";
        if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
        else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
        return;
      }
      const contentHeight = [...list.children].reduce((height, child) => {
        const style = getComputedStyle(child);
        return height + (child as HTMLElement).offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
      }, 0);
      const long = contentHeight + 60 > list.clientHeight;
      list.dataset.long = String(long);
      if (!long) {
        list.style.setProperty("--screen-list-half", "0px");
        list.style.setProperty("--screen-list-bottom", "60px");
        list.scrollTop = 0;
        return;
      }
      const alignment = list.clientHeight / 2;
      list.style.setProperty("--screen-list-half", `${alignment}px`);
      list.style.setProperty("--screen-list-bottom", `${list.clientHeight - alignment}px`);
      list.scrollTo({ top: row.offsetTop + row.offsetHeight / 2 - alignment, behavior: "instant" });
    };
    centerRef.current = center;
    center();
    let active = true;
    void document.fonts.ready.then(() => { if (active) center(); });
    document.fonts.addEventListener("loadingdone", center);
    const resize = new ResizeObserver(center);
    resize.observe(list);
    return () => { active = false; centerRef.current = null; resize.disconnect(); document.fonts.removeEventListener("loadingdone", center); };
  }, [selected, screen, flow, entries.length]);

  useEffect(() => {
    if (!focusOnMount) return;
    rowRefs.current[Math.min(selectedRef.current, entries.length - 1)]?.focus({ preventScroll: true });
  }, [focusOnMount, entries.length]);

  const move = (next: number) => {
    const clamped = Math.max(0, Math.min(entries.length - 1, next));
    setHover(null);
    if (clamped !== selected) {
      selectRef.current?.(clamped);
      blip("move");
    }
    rowRefs.current[clamped]?.focus({ preventScroll: screen || !compact });
    // Home/End and a boundary step also recover a list scrolled with the wheel.
    if (screen && clamped === selected) centerRef.current?.();
  };

  const glyph = (entry: XmbListEntry) => {
    if (entry.swatch) {
      return (
        <span className="xmb-list-icon" aria-hidden="true">
          <span
            className="xmb-list-swatch"
            style={{ background: `linear-gradient(180deg, ${entry.swatch[0]} 0%, ${entry.swatch[0]} 42%, ${entry.swatch[1]} 100%)` }}
          />
        </span>
      );
    }
    if (entry.icon) {
      return (
        <span className="xmb-list-icon" aria-hidden="true">
          <ConsoleIcon name={entry.icon} />
        </span>
      );
    }
    return null;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (entries.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const at = Math.max(0, Math.min(entries.length - 1, highlighted));
      move(
        e.key === "ArrowDown" ? at + 1
        : e.key === "ArrowUp" ? at - 1
        : e.key === "Home" ? 0
        : entries.length - 1,
      );
      return;
    }
    if ((e.key === "Enter" || e.key === " ") && activateRef.current) {
      e.preventDefault();
      if (entries[highlighted]?.href) rowRefs.current[highlighted]?.click();
      else activateRef.current(highlighted);
    }
  };

  return (
    <ul
      ref={(node) => { listRef.current = node; if (viewportRef) viewportRef.current = node; }}
      className={cn("xmb-list", compact && "xmb-list--compact", screen && "xmb-list--screen", className)}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={entries[highlighted] ? `xmb-row-${entries[highlighted].key}` : undefined}
      onKeyDown={onKeyDown}
      onMouseLeave={() => setHover(null)}
    >
      {entries.map((entry, index) => {
        // While hovering, the rows keep the anchor they had when the pointer
        // arrived; only the highlight moves. Otherwise the cursor entry sits
        // on the centre line, as on the hardware.
        const anchor = hover?.anchor ?? selected;
        const offset = index - anchor;
        const on = index === highlighted;
        const distance = Math.abs(index - highlighted);
        // Full mode: size and brightness interpolate with the distance from
        // the highlight, the way the hardware's list dissolves toward the
        // edges. Compact mode (pages): the cursor row stands a size larger
        // and the rest hold at a calm, even brightness.
        const scale = compact || distance === 0 ? 1 : Math.max(0.66, 0.85 - distance * 0.06);
        const opacity = screen ? (distance === 0 ? 1 : distance <= 2 ? 0.85 : Math.max(0.45, 0.85 - (distance - 2) * 0.1)) : compact
          ? (distance === 0 ? 1 : 0.75)
          : (distance === 0 ? 1 : Math.max(0.18, 0.8 - distance * 0.16));
        return (
          <li
            key={entry.key}
            id={`xmb-row-${entry.key}`}
            role="option"
            aria-selected={on}
            data-anchor-selected={index === selected}
            data-kind={entry.href ? "external" : entry.to ? "navigation" : entry.opensScreen ? "screen" : "action"}
            data-route={entry.to}
            className={cn("xmb-list-row", on && "is-selected")}
            style={{ "--row-offset": offset, "--item-scale": scale, opacity } as CSSProperties}
          >
            {entry.href ? (
              <a
                ref={(node) => { rowRefs.current[index] = node; }}
                className="xmb-list-link"
                data-info={entry.description ?? entry.sub ?? entry.title}
                href={entry.href}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={entry.ariaLabel}
                tabIndex={on ? 0 : -1}
                onPointerDown={(event) => { if (!compact && event.pointerType === "mouse" && event.button === 0) event.preventDefault(); }}
                onPointerEnter={(event) => {
                  if (event.pointerType !== "mouse") return;
                  setHover((h) => ({ anchor: h?.anchor ?? selected, index }));
                  blip("move");
                }}
                onFocus={() => { setHover(null); selectRef.current?.(index); }}
              >
                {glyph(entry)}
                <span className="xmb-list-body">
                  <span className="xmb-list-top">
                    {entry.fresh && <span className="xmb-list-new" aria-hidden="true" />}
                    <span className="xmb-list-title">
                      {entry.title}
                      {entry.sub && <span className="xmb-list-sub">{entry.sub}</span>}
                    </span>
                    {entry.value != null ? (
                      <span className="xmb-list-value">{entry.value}</span>
                    ) : entry.meta ? (
                      <span className="xmb-list-meta">{entry.meta}</span>
                    ) : null}
                  </span>
                  {!screen && on && entry.detail != null && (
                    <span className="xmb-list-detail">{entry.detail}</span>
                  )}
                </span>
                {screen && <span aria-hidden="true">↗</span>}
              </a>
            ) : (
              <button
                ref={(node) => { rowRefs.current[index] = node; }}
                type="button"
                className="xmb-list-link"
                data-info={entry.description ?? entry.sub ?? entry.title}
                aria-label={entry.ariaLabel}
                tabIndex={on ? 0 : -1}
                onClick={() => {
                  selectRef.current?.(index);
                  activateRef.current?.(index);
                }}
                onPointerDown={(event) => { if (!compact && event.pointerType === "mouse" && event.button === 0) event.preventDefault(); }}
                onPointerEnter={(event) => {
                  if (event.pointerType !== "mouse") return;
                  setHover((h) => ({ anchor: h?.anchor ?? selected, index }));
                  blip("move");
                }}
                onFocus={() => { setHover(null); selectRef.current?.(index); }}
              >
                {glyph(entry)}
                <span className="xmb-list-body">
                  <span className="xmb-list-top">
                    {entry.fresh && <span className="xmb-list-new" aria-hidden="true" />}
                    <span className="xmb-list-title">
                      {entry.title}
                      {entry.sub && <span className="xmb-list-sub">{entry.sub}</span>}
                    </span>
                    {entry.value != null ? (
                      <span className="xmb-list-value">{entry.value}</span>
                    ) : entry.meta ? (
                      <span className="xmb-list-meta">{entry.meta}</span>
                    ) : null}
                  </span>
                  {!screen && on && entry.detail != null && (
                    <span className="xmb-list-detail">{entry.detail}</span>
                  )}
                </span>
                {screen && (entry.to || entry.opensScreen) && <span aria-hidden="true">›</span>}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
