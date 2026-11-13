import type { ReactNode } from "react";
import { useInView } from "@/hooks/useInView";
import { getRouteDef, type RoutePath } from "@/router/routes";
import { cn } from "@/utils/cn";

export function Reveal({
  children,
  className,
  delay = 0,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "li" | "figure" | "article";
}) {
  const { ref, inView } = useInView<HTMLElement>({ once: true, threshold: 0.05 });
  const Tag = as as "div";
  return (
    <Tag
      ref={ref as never}
      data-visible={inView ? "true" : "false"}
      className={cn("reveal", className)}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1360px] px-5 @lg:px-8", className)}>{children}</div>;
}

/** Compact application header shown at the top of every app window. */
export function PageMasthead({
  path,
  eyebrow,
  title,
  lede,
  meta,
  aside,
  className,
}: {
  path: RoutePath;
  eyebrow: string;
  title: ReactNode;
  lede: ReactNode;
  meta?: Array<{ k: string; v: string; tone?: "amber" | "rust" | "moss" | "default" }>;
  aside?: ReactNode;
  className?: string;
}) {
  const def = getRouteDef(path);
  const toneClass = { amber: "text-amber", rust: "text-rust", moss: "text-moss", default: "text-paper" };

  return (
    <header className={cn("relative border-b border-line px-5 pb-5 pt-5 @lg:px-8", className)}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 schematic-grid opacity-40 [mask-image:linear-gradient(to_bottom,#000,transparent)]"
      />
      <div className="relative">
        <div className="grid gap-5 @3xl:grid-cols-12 @3xl:items-end">
          <div className={aside ? "@3xl:col-span-7" : "@3xl:col-span-12"}>
            <div className="label flex flex-wrap items-center justify-between gap-2 text-amber">
              <span className="flex items-center gap-2.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber" aria-hidden="true" />
                {eyebrow}
              </span>
              <span className="hidden text-faint @2xl:inline">{def.packetTag}</span>
            </div>
            <h1 className="display mt-2.5 text-balance text-[1.7rem] text-paper @2xl:text-[2.1rem] @5xl:text-[2.5rem]">
              {title}
            </h1>
            <p className="mt-3 max-w-[72ch] text-[14px] leading-[1.7] text-muted">{lede}</p>
            {meta && (
              <ul className="mt-4 flex flex-wrap gap-2">
                {meta.map((item) => (
                  <li
                    key={item.k}
                    className="flex items-baseline gap-2 rounded-full border border-line bg-white/[0.03] px-3 py-1 font-mono text-[10.5px]"
                  >
                    <span className="uppercase tracking-[0.1em] text-faint">{item.k}</span>
                    <span className={toneClass[item.tone ?? "default"]}>{item.v}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {aside && <div className="@3xl:col-span-5">{aside}</div>}
        </div>
      </div>
    </header>
  );
}

export function StatusBadge({
  tone,
  children,
}: {
  tone: "implemented" | "mock" | "unverified" | "absent" | "scope";
  children: ReactNode;
}) {
  const styles = {
    implemented: "border-moss/40 bg-moss/10 text-moss",
    mock: "border-amber/45 bg-amber/10 text-amber",
    unverified: "border-amber/35 bg-transparent text-amber",
    absent: "border-rust/45 bg-rust/10 text-rust",
    scope: "border-line-strong bg-panel text-muted",
  }[tone];

  const dot = {
    implemented: "bg-moss",
    mock: "bg-amber",
    unverified: "bg-amber",
    absent: "bg-rust",
    scope: "bg-faint",
  }[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.13em]",
        styles,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden="true" />
      {children}
    </span>
  );
}
