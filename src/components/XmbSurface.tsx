import type { ReactNode } from "react";
import { cn } from "@/utils/cn";
import { RouteLink } from "@/router/RouterContext";
import { ConsoleIcon } from "@/xmb/ConsoleIcons";
import type { GlyphName, ItemIcon } from "@/xmb/categories";

/** Any glyph of the console set: a category mark or an item mark. */
export type XmbGlyph = GlyphName | ItemIcon;

/**
 * A console column: square glass, a translucent head carrying the column's
 * glyph and title, and the body underneath. The crossbar shows columns; the
 * documents show them too, so a page reads like the menu that opened it.
 */
export function XmbColumn({
  icon,
  title,
  note,
  lede,
  children,
  className,
  bodyClassName,
}: {
  icon: XmbGlyph;
  title: string;
  note?: ReactNode;
  lede?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("xmb-surface flex h-full flex-col", className)}>
      <header className="xmb-column-head">
        <ConsoleIcon name={icon} tone="current" />
        <h2 className="xmb-column-title">{title}</h2>
        {note ? <span className="xmb-column-note">{note}</span> : null}
      </header>
      {lede ? <p className="xmb-column-lede">{lede}</p> : null}
      <div className={cn("flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

/** One entry of a column: glyph, small-caps key, value. Renders dt/dd. */
export function XmbRow({
  icon,
  label,
  children,
  className,
}: {
  icon?: XmbGlyph;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("xmb-row", className)}>
      {icon ? <ConsoleIcon name={icon} tone="current" className="xmb-row-icon" /> : null}
      <dt className="xmb-row-key">{label}</dt>
      <dd className="xmb-row-value">{children}</dd>
    </div>
  );
}

/** A destination tile: glyph, title, one line of detail. */
export function XmbTile({
  icon,
  title,
  sub,
  to,
  href,
  className,
}: {
  icon: XmbGlyph;
  title: string;
  sub: string;
  to?: string;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <ConsoleIcon name={icon} tone="current" />
      <span className="min-w-0">
        <span className="xmb-tile-title block">{title}</span>
        <span className="xmb-tile-sub block">{sub}</span>
      </span>
    </>
  );

  if (to) {
    return (
      <RouteLink to={to} className={cn("xmb-tile", className)}>
        {body}
      </RouteLink>
    );
  }
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={cn("xmb-tile", className)}>
        {body}
        <span aria-hidden="true" className="xmb-tile-sub ml-auto self-start">↗</span>
      </a>
    );
  }
  return <div className={cn("xmb-tile", className)}>{body}</div>;
}

/** The maintainer's tile: the console's own avatar glyph in glass. */
export function XmbAvatar({ icon = "project", className }: { icon?: XmbGlyph; className?: string }) {
  return (
    <span className={cn("xmb-avatar", className)}>
      <ConsoleIcon name={icon} tone="current" />
    </span>
  );
}
