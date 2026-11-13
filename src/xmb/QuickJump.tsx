import { useEffect, useMemo, useRef, useState } from "react";
import { SOURCE_EXCERPTS } from "@/data/repository";
import { useRouter } from "@/router/RouterContext";
import { cn } from "@/utils/cn";
import { CATEGORIES, itemTarget } from "./categories";
import { blip } from "./audio";

interface Entry {
  id: string;
  kind: string;
  code: string;
  title: string;
  sub: string;
  to?: string;
  href?: string;
}

/** ⌘K / "/" palette: jump to any destination or source excerpt. */
export function QuickJump() {
  const { setPaletteOpen, navigate } = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  const entries = useMemo<Entry[]>(() => {
    const dest: Entry[] = CATEGORIES.flatMap((c) =>
      c.items.map((it) => ({
        id: `${c.id}-${it.id}`,
        kind: c.label,
        code: it.code,
        title: it.label,
        sub: it.sub,
        to: itemTarget(it) ?? undefined,
        href: it.href,
      })),
    );
    const src: Entry[] = SOURCE_EXCERPTS.map((s) => ({
      id: `src-${s.id}`,
      kind: "Source",
      code: s.lang.toUpperCase(),
      title: s.shortTitle,
      sub: s.path,
      to: `/source?file=${s.id}`,
    }));
    return [...dest, ...src];
  }, []);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return entries.slice(0, 12);
    return entries.filter((e) => `${e.title} ${e.sub} ${e.kind}`.toLowerCase().includes(s));
  }, [entries, q]);

  const go = (e?: Entry) => {
    if (!e) return;
    blip("select");
    setPaletteOpen(false);
    if (e.to) navigate(e.to);
    else if (e.href) window.open(e.href, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Jump to a destination"
      className="xmb-fade-in fixed inset-0 z-[100] flex items-start justify-center bg-[rgba(2,8,28,0.7)] px-4 pt-[14vh]"
      onClick={() => setPaletteOpen(false)}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const all = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input, button:not([disabled]), a[href]'));
        const first = all[0];
        const last = all[all.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }}
    >
      <div className="xmb-glass w-full max-w-xl overflow-hidden rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <span className="font-mono text-[11px] text-amber">jump&gt;</span>
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((i) => (list.length ? (i + 1) % list.length : 0));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((i) => (list.length ? (i - 1 + list.length) % list.length : 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(list[sel]);
              } else if (e.key === "Escape") {
                setPaletteOpen(false);
              }
            }}
            placeholder="Destination, protocol, source file…"
            aria-label="Search destinations"
            className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-paper placeholder:text-faint focus:outline-none"
          />
          <kbd className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-faint">esc</kbd>
        </div>
        <ul className="code-scroll max-h-[50vh] overflow-y-auto">
          {list.length === 0 && <li className="px-4 py-6 font-mono text-[12px] text-faint">Nothing matches.</li>}
          {list.map((e, i) => (
            <li key={e.id}>
              <button
                type="button"
                onMouseEnter={() => setSel(i)}
                onClick={() => go(e)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors",
                  i === sel ? "bg-amber/[0.14]" : "hover:bg-white/[0.04]",
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/15 font-mono text-[10px] text-muted">
                  {e.code}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-paper">{e.title}</span>
                  <span className="block truncate font-mono text-[10.5px] text-faint">{e.sub}</span>
                </span>
                <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint">{e.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
