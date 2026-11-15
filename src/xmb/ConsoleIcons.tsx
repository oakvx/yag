import { useId } from "react";
import type { GlyphName, ItemIcon } from "./categories";
import { hasOptionalAsset, publicAsset } from "./assets";
import { XMB_ICON_PATHS } from "./xmbIcons";
import { EXTRA_ICON_PATHS } from "./extraIcons";

type Icon = ItemIcon | GlyphName;

/**
 * Optional slot for licensed artwork: drop an SVG named after the icon
 * (home.svg, gateway.svg, …) into public/icons/xmb/ and it replaces the
 * built-in outline, tinted with the same flat fill.
 */
function iconOverride(name: Icon): string | null {
  const path = `icons/xmb/${name}.svg`;
  return hasOptionalAsset(path) ? publicAsset(path) : null;
}

/**
 * XMB artwork: one traced outline per icon.
 *
 * White silhouettes belong to the XMB. Documents can inherit their text colour.
 */
export function ConsoleIcon({
  name,
  className,
  tone = "white",
}: {
  name: Icon;
  className?: string;
  tone?: "white" | "current";
}) {
  const override = iconOverride(name);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const outline = XMB_ICON_PATHS[name] ?? EXTRA_ICON_PATHS[name];
  const paint = tone === "white" ? "#fff" : "currentColor";

  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      {override && (
        <defs>
          <mask id={`art-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
            <image href={override} x="0" y="0" width="64" height="64" preserveAspectRatio="xMidYMid meet" />
          </mask>
        </defs>
      )}
      {override ? (
        <rect width="64" height="64" fill={paint} mask={`url(#art-${id})`} />
      ) : (
        <path d={outline} fill={paint} fillRule="evenodd" />
      )}
    </svg>
  );
}
