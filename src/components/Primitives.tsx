import type { ReactNode } from "react";
import { useInView } from "@/hooks/useInView";
import type { RoutePath } from "@/router/routes";
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

/** Page head: the shell already shows icon and title, so this is the description plus a few facts. */
export function PageMasthead({
  title,
  lede,
  meta,
  aside,
  className,
}: {
  path?: RoutePath;
  eyebrow?: string;
  title: ReactNode;
  lede: ReactNode;
  meta?: Array<{ k: string; v: string; tone?: "amber" | "rust" | "moss" | "default" }>;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("xmb-masthead px-5 pb-3 pt-1 @lg:px-8", className)}>
      <h1 className="display xmb-masthead-title">{title}</h1>
      <p className="xmb-masthead-lede">{lede}</p>
      {meta && (
        <dl className="xmb-masthead-meta">
          {meta.map((item) => (
            <div key={item.k}>
              <dt>{item.k}</dt>
              <dd>{item.v}</dd>
            </div>
          ))}
        </dl>
      )}
      {aside && <div className="mt-4">{aside}</div>}
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
