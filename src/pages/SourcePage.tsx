import { useEffect, useRef, useState } from "react";
import { XmbDocument } from "@/components/XmbDocument";
import { XmbRow } from "@/components/XmbRow";
import { CodeBlock } from "@/components/CodeBlock";
import { REPO_LINKS, SOURCE_EXCERPTS, type SourceCategory } from "@/data/repository";
import { PROJECT_SNAPSHOT } from "@/data/project-snapshot.generated";
import { PROJECT_REVIEW } from "@/data/projectKnowledge";
import { useRouter } from "@/router/RouterContext";

const CATEGORIES: Array<"All" | SourceCategory> = ["All", "Entry & Structs", "Listener & Auth", "Routing & Transport", "Protocol Adapters", "Control Plane", "Build & Tests"];

export function SourcePage() {
  const { query } = useRouter();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(query.file ?? SOURCE_EXCERPTS[0].id);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const detail = useRef<HTMLElement>(null);
  useEffect(() => { setSelectedId(query.file ?? SOURCE_EXCERPTS[0].id); setCategory("All"); setSearch(""); }, [query.file]);
  const filtered = SOURCE_EXCERPTS.filter(item => (category === "All" || item.category === category)
    && `${item.shortTitle} ${item.path} ${item.summary}`.toLowerCase().includes(search.trim().toLowerCase()));
  const selected = filtered.find(item => item.id === selectedId) ?? filtered[0];
  return <XmbDocument sections={[]} introduction={<>
    <p>Read exact excerpts from the host, protocol adapters and contract tests. Choose a file on the left; its implementation and engineering notes stay together on the right.</p>
    <p className="xmb-document-meta">C17 · POSIX · {SOURCE_EXCERPTS.length} source excerpts · Reviewed against <a href={`${REPO_LINKS.repo}/commit/${PROJECT_SNAPSHOT.revision}`} target="_blank" rel="noreferrer">main @ {PROJECT_SNAPSHOT.revision.slice(0, 7)}</a> · {PROJECT_REVIEW.date}</p>
  </>}>
    <div className="source-filters">
      <label>Find a file<input type="search" value={search} placeholder="File, function or topic" onChange={event => setSearch(event.target.value)} onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (search) setSearch(""); else if (selected) buttons.current[selected.id]?.focus(); }
      }} /></label>
      <label>Subsystem<select value={category} onChange={event => setCategory(event.target.value as typeof category)}>{CATEGORIES.map(item => <option key={item}>{item}</option>)}</select></label>
      <p role="status">{filtered.length} of {SOURCE_EXCERPTS.length} excerpts</p>
      <a href={REPO_LINKS.repo} target="_blank" rel="noreferrer">Full repository ↗</a>
    </div>
    {selected ? <div className="source-workspace">
      <nav className="source-file-list" aria-label="Source files" onKeyDown={event => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const index = filtered.indexOf(selected);
        const next = event.key === "Home" ? 0 : event.key === "End" ? filtered.length - 1 : Math.max(0, Math.min(filtered.length - 1, index + (event.key === "ArrowUp" ? -1 : 1)));
        setSelectedId(filtered[next].id); buttons.current[filtered[next].id]?.focus();
      }}>
        {filtered.map(item => <button key={item.id} type="button" ref={element => { buttons.current[item.id] = element; }}
          aria-pressed={item.id === selected.id} aria-controls="source-detail" tabIndex={item.id === selected.id ? 0 : -1}
          data-info={item.summary} onClick={() => setSelectedId(item.id)}>
          <span className="source-file-category">{item.category}</span><span className="source-file-name">{item.shortTitle}</span><span className="source-file-path">{item.path}</span>
        </button>)}
      </nav>
      <button className="source-read-selection" type="button" onClick={() => { detail.current?.scrollIntoView({ block: "start" }); detail.current?.focus({ preventScroll: true }); }}>Read {selected.shortTitle} ↓</button>
      <section id="source-detail" className="source-detail" ref={detail} tabIndex={-1} aria-label={selected.shortTitle}>
        <p className="xmb-document-eyebrow">{selected.kindLabel} · Lines {selected.startLine}–{selected.endLine}</p>
        <h3>{selected.shortTitle}</h3><p>{selected.summary}</p>
        <CodeBlock code={selected.code} lang={selected.lang} path={selected.path} href={selected.href} startLine={selected.startLine} />
      </section>
      <aside className="source-notes" aria-label="Engineering notes">
        <h3>Engineering notes</h3><ul>{selected.notes.map(note => <li key={note}>{note}</li>)}</ul>
        <h3>About this excerpt</h3><p>{selected.caveat}</p><XmbRow to={selected.relatedRoute}>{selected.relatedLabel}</XmbRow>
      </aside>
    </div> : <div className="source-empty"><h3>No matching files</h3><p>Try a filename such as config, or a topic such as routing.</p><XmbRow onClick={() => { setSearch(""); setCategory("All"); }}>Show all excerpts</XmbRow></div>}
  </XmbDocument>;
}
