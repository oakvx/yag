import { useEffect, useMemo, useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { Container, PageMasthead, StatusBadge } from "@/components/Primitives";
import {
  REPO_LINKS,
  SOURCE_EXCERPTS,
  getExcerptById,
  type SourceCategory,
} from "@/data/repository";
import { RouteLink, useRouter } from "@/router/RouterContext";
import { cn } from "@/utils/cn";

const CATEGORIES: Array<"All" | SourceCategory> = [
  "All",
  "Entry & Structs",
  "Listener & Auth",
  "Routing & Transport",
  "Protocol Adapters",
  "Build & Tests",
];

export function SourcePage() {
  const { query } = useRouter();
  const [category, setCategory] = useState<"All" | SourceCategory>("All");
  const [selectedId, setSelectedId] = useState<string>(query.file || SOURCE_EXCERPTS[0].id);

  useEffect(() => {
    if (query.file) {
      const found = SOURCE_EXCERPTS.find((s) => s.id === query.file);
      if (found) {
        setSelectedId(found.id);
        setCategory("All");
      }
    }
  }, [query.file]);

  const filtered = useMemo(
    () => (category === "All" ? SOURCE_EXCERPTS : SOURCE_EXCERPTS.filter((e) => e.category === category)),
    [category],
  );

  const active = getExcerptById(selectedId);

  return (
    <div>
      <PageMasthead
        path="/source"
        eyebrow="Chapter 06 · Source-Code Atlas"
        title={
          <>
            Read the actual C17 host, <em>not marketing paraphrases.</em>
          </>
        }
        lede="Every excerpt in this atlas comes directly from oakvx/yag — preserving syntax, variable names, comments, and error messages. Move across the file tree to see how socket admission, constant-time key verification, exact-model routing, and protocol adapters fit together."
        meta={[
          { k: "Host standard", v: "ISO C17 + _POSIX_C_SOURCE=200809L", tone: "amber" },
          { k: "Compiler flags", v: "-Wall -Wextra -Wpedantic" },
          { k: "Source policy", v: "Verbatim repository excerpts", tone: "moss" },
        ]}
      />

      <section className="py-6 @lg:py-8">
        <Container>
          {/* Subsystem Filter Bar */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-line bg-panel px-4 py-2.5">
            <div role="tablist" aria-label="Filter source excerpts by subsystem" className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  role="tab"
                  aria-selected={category === cat}
                  onClick={() => {
                    setCategory(cat);
                    const nextList =
                      cat === "All" ? SOURCE_EXCERPTS : SOURCE_EXCERPTS.filter((e) => e.category === cat);
                    if (nextList.length && !nextList.some((e) => e.id === selectedId)) {
                      setSelectedId(nextList[0].id);
                    }
                  }}
                  className={cn(
                    "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.13em] transition-colors cursor-pointer",
                    category === cat
                      ? "border-amber bg-amber/15 text-paper"
                      : "border-line text-faint hover:text-paper",
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
            <a
              href={REPO_LINKS.repo}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-[10.5px] text-muted hover:text-amber"
            >
              Browse full tree on GitHub ↗
            </a>
          </div>

          {/* 3-Pane Split Source Atlas */}
          <div className="grid border border-line-strong bg-panel @3xl:grid-cols-12">
            {/* Left Pane: Repository Tree */}
            <aside className="border-b border-line bg-[rgba(3,12,34,0.55)] @3xl:col-span-3 @3xl:border-b-0 @3xl:border-r">
              <div className="border-b border-line px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.15em] text-faint">
                oakvx/yag · {filtered.length} Excerpts
              </div>
              <ul className="divide-y divide-line">
                {filtered.map((item) => {
                  const isCurrent = item.id === active.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                        className={cn(
                          "w-full px-4 py-3 text-left transition-colors cursor-pointer",
                          isCurrent
                            ? "border-l-2 border-l-amber bg-amber/[0.09]"
                            : "border-l-2 border-l-transparent hover:bg-paper/[0.03]",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2 font-mono text-[9.5px]">
                          <span className={isCurrent ? "text-amber" : "text-faint"}>{item.category}</span>
                          <span className="uppercase text-faint">{item.lang}</span>
                        </div>
                        <div className="mt-1 text-[13px] font-medium text-paper">{item.shortTitle}</div>
                        <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted">{item.path}</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            {/* Center Pane: Syntax-Highlighted Source */}
            <div className="border-b border-line p-4 @lg:p-6 @3xl:col-span-6 @3xl:border-b-0 @3xl:border-r">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <StatusBadge tone={active.kindLabel === "Mock Contract Test" ? "mock" : "implemented"}>
                  {active.kindLabel}
                </StatusBadge>
                <a
                  href={active.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-mono text-[11px] text-amber hover:underline"
                >
                  Open {active.path} on GitHub ↗
                </a>
              </div>

              <p className="mb-4 text-[14px] leading-relaxed text-muted">{active.summary}</p>

              <CodeBlock
                key={active.id}
                code={active.code}
                lang={active.lang}
                path={active.path}
                href={active.href}
                highlights={active.highlights}
              />
            </div>

            {/* Right Pane: Architectural Annotations */}
            <div className="p-4 @lg:p-6 @3xl:col-span-3 flex flex-col justify-between" aria-live="polite">
              <div>
                <p className="label text-amber">Engineering Notes</p>
                <h2 className="mt-2 font-serif text-2xl text-paper">{active.shortTitle}</h2>

                <ul className="mt-4 space-y-3 border-t border-line pt-4">
                  {active.notes.map((note) => (
                    <li key={note} className="flex gap-2.5 text-[12.5px] leading-relaxed text-muted">
                      <span aria-hidden="true" className="font-mono text-amber">▪</span>
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-5 border border-line bg-ink p-3">
                  <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">Scope / Excerpt Note</p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{active.caveat}</p>
                </div>
              </div>

              <div className="mt-6 border-t border-line pt-4">
                <RouteLink to={active.relatedRoute} className="btn btn-amber w-full">
                  {active.relatedLabel} →
                </RouteLink>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}
