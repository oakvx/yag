import { useEffect, useRef, useState, type ReactNode } from "react";
import { XmbList } from "@/xmb/XmbList";
import { useRouter } from "@/router/RouterContext";
import { XmbInfoLine, XmbPanel, XmbSectionLabel, ScrollEdges, type XmbScreenEntry, type XmbScreenSection } from "./XmbScreen";
import { XmbRow } from "./XmbRow";
import { getRouteDef } from "@/router/routes";

const HEADLINES: Record<string, string> = {
  "/": "One gateway between your apps and your models.",
  "/problem": "Give every client one place to connect.",
  "/architecture": "Follow the request through the host.",
  "/lifecycle": "See what happens at every stage.",
  "/protocols": "Understand what each protocol can carry.",
  "/routing": "Choose a model. Inspect the route.",
  "/source": "Explore the implementation, file by file.",
  "/security": "Know the boundaries before you deploy.",
  "/status": "What works, what is tested, what remains open.",
  "/deploy": "From a local build to a private LAN gateway.",
  "/project": "The project, its scope and where to contribute.",
  "/profile": "The people and project behind YAG.",
};

function explanation(entry: XmbScreenEntry) {
  return entry.panel ?? entry.detail ?? <p>{entry.description ?? entry.sub ?? entry.value}</p>;
}

function DocumentSection({ section, initialSelected, onInfo }: {
  section: XmbScreenSection;
  initialSelected: number;
  onInfo: (text: string) => void;
}) {
  const [cursor, setCursor] = useState(initialSelected);
  const [highlight, setHighlight] = useState(initialSelected);
  const { navigate } = useRouter();
  const viewport = useRef<HTMLUListElement>(null);
  const selected = Math.min(cursor, section.entries.length - 1);
  const current = section.entries[Math.min(highlight, section.entries.length - 1)];
  const interactive = section.preview || section.interactive || section.entries.some((entry) => entry.activate);
  const controls = section.entries.map((entry) => ({ ...entry, opensScreen: !!entry.to }));
  return <section id={`section-${section.id}`} tabIndex={-1} className="xmb-document-section" data-interactive={!!interactive} aria-label={section.label}>
    <XmbSectionLabel>{section.label}</XmbSectionLabel>
    {interactive ? <div className="xmb-document-tool">
      <div className="xmb-document-selection">
        <XmbList entries={controls} selected={selected} ariaLabel={section.label} screen flow viewportRef={viewport}
          onSelect={(index) => { setCursor(index); setHighlight(index); }} onHighlight={(index) => { setHighlight(index); const entry = section.entries[index]; if (viewport.current?.contains(document.activeElement)) onInfo(entry.description ?? entry.sub ?? entry.title); }}
          onActivate={(index) => { const entry = section.entries[index]; if (entry.to) navigate(entry.to); else entry.activate?.(); }} />
        <ScrollEdges targetRef={viewport} />
      </div>
      <div className="xmb-document-detail">
        {current?.description && <p>{current.description}</p>}
        {current?.panel || current?.detail ? explanation(current) : section.panel}
      </div>
    </div> : <>
      {section.entries.map((entry) => entry.to || entry.href || entry.activate ?
        <XmbRow key={entry.key} to={entry.to} href={entry.href} onClick={entry.activate} value={entry.value} hint={entry.description ?? entry.sub ?? entry.title}>{entry.title}</XmbRow>
        : <div key={entry.key} className="xmb-document-topic">
          <h3>{entry.title}{entry.value && <span className="xmb-document-value"> · {entry.value}</span>}</h3>
          {(entry.panel || entry.detail || entry.description || entry.sub) && explanation(entry)}
        </div>)}
      {section.panel}
    </>}
  </section>;
}

/** Reading comes first. Only interactive tools use a selection list. */
export function XmbDocument({ introduction, sections, initialSelected = 0, initialSection, children }: {
  introduction: ReactNode;
  sections: XmbScreenSection[];
  initialSelected?: number;
  initialSection?: number;
  children?: ReactNode;
}) {
  const { path } = useRouter();
  const route = getRouteDef(path);
  const panel = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState("Up / Down to read or select · Left / Right to move between controls");
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      panel.current?.focus({ preventScroll: true });
      if (initialSection !== undefined && panel.current) {
        const section = panel.current.querySelectorAll<HTMLElement>(".xmb-document-section")[initialSection];
        if (section) panel.current.scrollTop += section.getBoundingClientRect().top - panel.current.getBoundingClientRect().top - 18;
      }
    });
    window.dispatchEvent(new CustomEvent("yag:screen-title", { detail: "" }));
    return () => cancelAnimationFrame(frame);
  }, [initialSection]);
  return <div className="xmb-screen xmb-document" data-view="document" data-selectable="true"
    onFocusCapture={(event) => { const hint = (event.target as HTMLElement).closest<HTMLElement>("[data-info]")?.dataset.info; if (hint) setInfo(hint); }}
    onKeyDown={(event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, select")) return;
      const region = panel.current;
      if (!region) return;
      if ((target === region || target.matches("section[tabindex='-1']")) && ["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
        event.preventDefault();
        region.scrollTo({ top: event.key === "Home" ? 0 : event.key === "End" ? region.scrollHeight : region.scrollTop + (event.key === "ArrowUp" ? -72 : event.key === "PageUp" ? -region.clientHeight * .8 : event.key === "PageDown" ? region.clientHeight * .8 : 72) });
      } else if (["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const controls = [region, ...region.querySelectorAll<HTMLElement>("button:not(:disabled),a[href],input,select")].filter((element) => element.tabIndex >= 0 && element.getClientRects().length);
        const index = controls.indexOf(target);
        const next = Math.max(0, Math.min(controls.length - 1, index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1)));
        controls[next]?.focus();
      }
    }}>
    <div className="xmb-text-screen">
      <XmbPanel panelRef={panel}>
        <header className="xmb-document-introduction">
          <p className="xmb-document-eyebrow">Chapter {route.index} · {route.label}</p>
          <h2 className="xmb-document-title">{HEADLINES[path] ?? route.label}</h2>
          {introduction}
        </header>
        {sections.length > 1 && <nav className="xmb-document-contents" aria-label="On this page">
          <span>On this page</span>
          {sections.map((section) => <button key={section.id} type="button" onClick={() => {
            const target = panel.current?.querySelector<HTMLElement>(`#${CSS.escape(`section-${section.id}`)}`);
            target?.scrollIntoView({ block: "start" }); target?.focus({ preventScroll: true });
            setInfo(section.label);
          }}>{section.label}</button>)}
        </nav>}
        {children}
        {sections.map((section) => <DocumentSection key={section.id} section={section} initialSelected={initialSelected} onInfo={setInfo} />)}
      </XmbPanel>
      <ScrollEdges targetRef={panel} />
    </div>
    <XmbInfoLine>{info.length > 140 ? `${info.slice(0,137)}…` : info}</XmbInfoLine>
  </div>;
}
