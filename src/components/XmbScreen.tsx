import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { XmbList, type XmbListEntry } from "@/xmb/XmbList";
import { blip } from "@/xmb/audio";
import { useRouter } from "@/router/RouterContext";
import { XmbDocument } from "./XmbDocument";

export interface XmbScreenEntry extends XmbListEntry {
  description?: string;
  panel?: ReactNode;
  activate?: () => void;
  sectionId?: string;
}
export interface XmbScreenSection {
  id: string;
  label: string;
  entries: XmbScreenEntry[];
  panel?: ReactNode;
  /** Signal paths keep their synchronized diagram below the selection. */
  preview?: boolean;
  interactive?: boolean;
}

export function XmbPanel({ children, panelRef }: { children: ReactNode; panelRef?: RefObject<HTMLDivElement | null> }) {
  return <div ref={panelRef} className="xmb-text-panel" role="region" tabIndex={0} aria-label="Details">{children}</div>;
}
export function XmbSectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="xmb-section-label">{children}</h2>;
}
export function XmbInfoLine({ children }: { children: ReactNode }) {
  return <p className="xmb-info-line" aria-live="polite" aria-atomic="true">{children}</p>;
}

export function ScrollEdges({ targetRef }: { targetRef: RefObject<HTMLElement | null> }) {
  const [edges, setEdges] = useState({ up: false, down: false });
  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    const update = () => {
      const up = el.scrollTop > 2;
      const down = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
      el.dataset.scrollable = String(el.scrollHeight > el.clientHeight + 2);
      setEdges((old) => old.up === up && old.down === down ? old : { up, down });
    };
    const resize = new ResizeObserver(update);
    resize.observe(el);
    const mutation = new MutationObserver(() => { update(); for (const child of el.children) resize.observe(child); });
    mutation.observe(el, { childList: true, subtree: true });
    for (const child of el.children) resize.observe(child);
    el.addEventListener("scroll", update, { passive: true });
    update();
    return () => { resize.disconnect(); mutation.disconnect(); el.removeEventListener("scroll", update); };
  }, [targetRef]);
  return <div className="xmb-scroll-indicators" aria-hidden="true"><span data-visible={edges.up}>▲</span><span data-visible={edges.down}>▼</span></div>;
}

export function XmbTextScreen({ children, focus = true }: { children: ReactNode; focus?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (focus) panel.current?.focus({ preventScroll: true }); }, [focus]);
  return <div className="xmb-text-screen"><XmbPanel panelRef={panel}>{children}</XmbPanel><ScrollEdges targetRef={panel} /></div>;
}

function shortInfo(value: string) {
  return value.length <= 140 ? value : `${value.slice(0, 137).replace(/\s+\S*$/, "")}…`;
}

/** Root → section rows → text. Each level retains its cursor on return. */
interface XmbScreenProps {
  subtitle: string;
  header?: ReactNode;
  sections: XmbScreenSection[];
  rootEntries?: XmbScreenEntry[];
  selected?: number;
  initialSelected?: number;
  initialSection?: number;
  onSelect?: (index: number) => void;
  onHighlight?: (index: number) => void;
  onActivate?: (index: number) => void;
  testId?: string;
  document?: ReactNode;
}

export function XmbScreen(props: XmbScreenProps) {
  if (props.document) return <XmbDocument introduction={props.document} sections={props.sections} initialSelected={props.initialSelected} initialSection={props.initialSection} />;
  return <XmbListScreen {...props} />;
}

function XmbListScreen({ subtitle, header, sections, rootEntries, selected, onSelect, onHighlight, onActivate, initialSelected = 0, initialSection, testId }: XmbScreenProps) {
  const { navigate } = useRouter();
  const hasRoot = !!rootEntries || sections.length > 1;
  const [sectionIndex, setSectionIndex] = useState<number | null>(initialSection ?? (hasRoot ? null : 0));
  const [textKey, setTextKey] = useState<string | null>(null);
  const [cursors, setCursors] = useState<Record<string, number>>({});
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [focusInfo, setFocusInfo] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLUListElement>(null);
  const section = sectionIndex === null ? undefined : sections[sectionIndex];
  const level = section?.id ?? "$root";
  const entries: XmbScreenEntry[] = section ? [
    ...section.entries,
    ...(section.panel && !section.preview ? [{ key: "$details", title: "View details", value: section.label, panel: section.panel, description: "Open the current result and its explanation." }] : []),
  ] : rootEntries ?? sections.map((item) => ({ key: item.id, title: item.label, value: `${item.entries.length} items`, sectionId: item.id, description: `Open ${item.label.toLowerCase()}.` }));
  const cursor = Math.max(0, Math.min(section && selected !== undefined ? selected : cursors[level] ?? (section ? initialSelected : 0), entries.length - 1));
  const current = entries[hoverIndex ?? cursor] ?? entries[cursor];
  const textEntry = entries.find((entry) => entry.key === textKey);
  const description = (entry?: XmbScreenEntry) => entry?.description ?? entry?.sub ?? entry?.value ?? subtitle;
  const detail = (entry?: XmbScreenEntry) => entry?.panel ?? entry?.detail ?? <p>{description(entry)}</p>;
  const select = (index: number) => {
    setCursors((old) => ({ ...old, [level]: index }));
    setHoverIndex(null); setFocusInfo(null);
    if (section && index < section.entries.length) onSelect?.(index);
  };
  const openSection = (index: number) => {
    setSectionIndex(index); setTextKey(null); setHoverIndex(null); setFocusInfo(null); blip("category");
  };
  const back = () => {
    if (textKey !== null) { setTextKey(null); setFocusInfo(null); return true; }
    if (section && hasRoot) { setSectionIndex(null); setHoverIndex(null); setFocusInfo(null); return true; }
    return false;
  };
  const activate = (index: number) => {
    const entry = entries[index];
    if (!entry) return;
    select(index);
    if (entry.sectionId) openSection(sections.findIndex((item) => item.id === entry.sectionId));
    else if (entry.href) viewport.current?.querySelectorAll<HTMLAnchorElement>(".xmb-list-link")[index]?.click();
    else if (entry.to) navigate(entry.to);
    else if (entry.activate || (section && onActivate)) { entry.activate?.(); onActivate?.(index); }
    else if (section?.preview) rootRef.current?.querySelector<HTMLElement>(".xmb-text-panel")?.focus();
    else setTextKey(entry.key);
  };

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("yag:screen-title", { detail: textEntry?.title ?? section?.label ?? "" }));
    return () => { window.dispatchEvent(new CustomEvent("yag:screen-title", { detail: "" })); };
  }, [section?.label, textEntry?.title]);
  useLayoutEffect(() => {
    if (!textKey) viewport.current?.querySelector<HTMLElement>(".is-selected .xmb-list-link")?.focus({ preventScroll: true });
  }, [level, textKey]);

  const keyRef = useRef<(event: KeyboardEvent) => void>(() => {});
  keyRef.current = (event) => {
    const root = rootRef.current;
    if (!root || root.closest("[inert]") || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("[role=dialog]")) return;
    const editing = !!target?.closest("input, textarea, select, [contenteditable=true]");
    if (editing && event.key !== "Escape") return;
    if (["Escape", "Backspace"].includes(event.key)) {
      if (back()) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    if (section && ["PageUp", "PageDown"].includes(event.key)) {
      event.preventDefault();
      openSection(Math.max(0, Math.min(sections.length - 1, (sectionIndex ?? 0) + (event.key === "PageDown" ? 1 : -1))));
      return;
    }
    const panel = root.querySelector<HTMLElement>(".xmb-text-panel");
    if (target && panel?.contains(target)) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (textKey) back(); else viewport.current?.querySelector<HTMLElement>(".is-selected .xmb-list-link")?.focus({ preventScroll: true });
      } else if (target === panel && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        panel.scrollTo({ top: event.key === "Home" ? 0 : event.key === "End" ? panel.scrollHeight : panel.scrollTop + (event.key === "ArrowDown" ? 72 : -72) });
      } else if (["ArrowDown", "ArrowUp", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        const controls = [panel, ...panel.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input")];
        const index = controls.indexOf(target);
        controls[Math.max(0, Math.min(controls.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)))]?.focus();
      }
      return;
    }
    if (event.key === "ArrowLeft") { if (back()) event.preventDefault(); }
    else if (event.key === "ArrowRight") { event.preventDefault(); activate(cursor); }
    else if (!target?.closest(".xmb-list, button, a") && ["ArrowDown", "ArrowUp", "Home", "End", "Enter"].includes(event.key)) {
      event.preventDefault();
      if (textKey) panel?.focus();
      else {
        viewport.current?.querySelector<HTMLElement>(".is-selected .xmb-list-link")?.focus({ preventScroll: true });
        viewport.current?.dispatchEvent(new KeyboardEvent("keydown", { key: event.key, bubbles: true, cancelable: true }));
      }
    }
  };
  useEffect(() => {
    const backKey = (event: KeyboardEvent) => { if (["Escape", "Backspace"].includes(event.key)) keyRef.current(event); };
    const key = (event: KeyboardEvent) => { if (!["Escape", "Backspace"].includes(event.key)) keyRef.current(event); };
    window.addEventListener("keydown", backKey, true);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", backKey, true); window.removeEventListener("keydown", key); };
  }, []);

  const rows = entries.map((entry) => ({ ...entry, opensScreen: !!(entry.sectionId || entry.to || (!entry.activate && !onActivate && !entry.href)) }));
  return <div ref={rootRef} className="xmb-screen" data-view={textEntry ? "text" : section?.preview ? "preview" : "list"}
    data-has-header={header != null && !textEntry}
    data-level={level} data-testid={testId} data-selectable="true"
    onFocusCapture={(event) => setFocusInfo((event.target as HTMLElement).closest<HTMLElement>("[data-info]")?.dataset.info ?? null)}>
    {textEntry ? <XmbTextScreen key={textEntry.key}>{detail(textEntry)}</XmbTextScreen> : <>
      {header != null && <div className="xmb-screen-header">{header}</div>}
      <div className="xmb-screen-list-region">
        <XmbList key={level} entries={rows} selected={cursor} ariaLabel={section?.label ?? "Destinations"} screen viewportRef={viewport}
          onSelect={select} onHighlight={(index) => { setHoverIndex(index); if (section && index < section.entries.length) onHighlight?.(index); }} onActivate={activate} />
        <ScrollEdges key={`${level}-edges`} targetRef={viewport} />
      </div>
      {section?.preview && <XmbTextScreen key={current?.key} focus={false}>{detail(current)}</XmbTextScreen>}
    </>}
    <XmbInfoLine>{shortInfo(focusInfo ?? (textEntry ? description(textEntry) : description(current)))}</XmbInfoLine>
  </div>;
}
