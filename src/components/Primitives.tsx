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
    <header className={cn("px-5 pb-2 pt-4 @lg:px-8", className)}>
      <div className="grid gap-5 @3xl:grid-cols-12 @3xl:items-end">
        <div className={aside ? "@3xl:col-span-7" : "@3xl:col-span-12"}>
          <div className="flex flex-wrap items-center justify-between gap-2 font-xmb text-[12.5px] text-muted">
            <span>{eyebrow}</span>
            <span className="hidden text-faint @2xl:inline">{def.packetTag}</span>
          </div>
          <h1 className="display mt-2 text-balance text-[1.65rem] text-paper @2xl:text-[2.05rem] @5xl:text-[2.4rem]">
            {title}
          </h1>
          <p className="mt-2.5 max-w-[72ch] font-xmb text-[14.5px] leading-[1.65] text-muted">{lede}</p>
          {meta && (
            <p className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-xmb text-[12.5px]">
              {meta.map((item) => (
                <span key={item.k}>
                  <span className="text-faint">{item.k}</span>{" "}
                  <span className={toneClass[item.tone ?? "default"]}>{item.v}</span>
                </span>
              ))}
            </p>
          )}
        </div>
        {aside && <div className="@3xl:col-span-5">{aside}</div>}
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
  const text = {
    implemented: "text-moss",
    mock: "text-amber",
    unverified: "text-amber",
    absent: "text-rust",
    scope: "text-muted",
  }[tone];

  const dot = {
    implemented: "bg-moss",
    mock: "bg-amber",
    unverified: "bg-amber",
    absent: "bg-rust",
    scope: "bg-faint",
  }[tone];

  return (
    <span className={cn("inline-flex items-center gap-1.5 font-xmb text-[12px]", text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden="true" />
      {children}
    </span>
  );
}
