import { type ReactNode } from "react";
import { RouteLink } from "@/router/RouterContext";

/** Actions keep native semantics while sharing the console's focus treatment. */
export function XmbRow({ children, value, hint, to, href, onClick, disabled = false, ariaLabel }: {
  children: ReactNode;
  value?: ReactNode;
  hint?: string;
  to?: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const body = <><span className="xmb-action-label">{children}</span><span className="xmb-action-value">{value}</span>{(to || href) && <span aria-hidden="true">{href ? "↗" : "›"}</span>}</>;
  const props = { className: "xmb-action-row", "aria-label": ariaLabel, "data-info": hint ?? (typeof children === "string" ? children : undefined) };
  if (to) return <RouteLink {...props} to={to}>{body}</RouteLink>;
  if (href) return <a {...props} href={href} target="_blank" rel="noreferrer noopener">{body}</a>;
  return <button {...props} type="button" disabled={disabled} onClick={onClick}>{body}</button>;
}

