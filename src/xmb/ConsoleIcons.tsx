import { useId } from "react";
import type { GlyphName, ItemIcon } from "./categories";
import { hasOptionalAsset, publicAsset } from "./assets";
import { XMB_ICON_PATHS } from "./xmbIcons";

type Icon = ItemIcon | GlyphName;

/**
 * Optional slot for licensed artwork: drop an SVG named after the icon
 * (home.svg, gateway.svg, …) into public/icons/xmb/ and it replaces the
 * built-in outline, tinted with the same silver gradient.
 */
function iconOverride(name: Icon): string | null {
  const path = `icons/xmb/${name}.svg`;
  return hasOptionalAsset(path) ? publicAsset(path) : null;
}

/** XMB artwork: one traced outline per icon, filled with the console gradient. */
export function ConsoleIcon({ name, className }: { name: Icon; className?: string }) {
  const override = iconOverride(name);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const silver = `url(#silver-${id})`;
  const outline = XMB_ICON_PATHS[name];

  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={`silver-${id}`} x1="22" y1="4" x2="40" y2="59" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" /><stop offset=".28" stopColor="#e9f2f5" />
          <stop offset=".5" stopColor="#c2d0da" /><stop offset=".55" stopColor="#91a4b5" />
          <stop offset=".85" stopColor="#adbdc9" /><stop offset="1" stopColor="#8194a6" />
        </linearGradient>
        {override && (
          <mask id={`art-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
            <image href={override} x="0" y="0" width="64" height="64" preserveAspectRatio="xMidYMid meet" />
          </mask>
        )}
      </defs>
      {override ? (
        <rect width="64" height="64" fill={silver} mask={`url(#art-${id})`} />
      ) : (
        <path d={outline} fill={silver} fillRule="evenodd" />
      )}
    </svg>
  );
}
