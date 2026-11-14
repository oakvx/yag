import { useId } from "react";
import type { GlyphName, ItemIcon } from "./categories";

type Icon = ItemIcon | GlyphName;

/** Original metallic silhouettes with one independent gradient per rendered icon. */
export function ConsoleIcon({ name, className }: { name: Icon; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const silver = `url(#silver-${id})`;
  const line = { fill: "none", stroke: silver, strokeWidth: 3.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  let artwork;

  switch (name) {
    case "home":
      artwork = <>
        <path d="M5 29 31 7a2 2 0 0 1 2 0l26 22H50v24H14V29z" fill={silver} />
        <path d="M26 51V35a6 6 0 0 1 12 0v16" fill="#294b65" />
        <path d="M23 27h18" stroke="#fff" strokeOpacity=".4" strokeWidth="1.4" />
        <path d="M31.7 12 9 31" stroke="#fff" strokeOpacity=".5" fill="none" />
      </>;
      break;
    case "explore":
    case "globe":
      artwork = <g {...line}>
        <circle cx="32" cy="31" r="23" />
        <ellipse cx="32" cy="31" rx="11" ry="23" strokeWidth="2.8" />
        <path d="M10 23h44M10 39h44M9 31h46M32 8v46" strokeWidth="2.5" />
        <path d="M17 16c10 5 20 5 30 0M17 46c10-5 20-5 30 0" strokeWidth="2" />
      </g>;
      break;
    case "protocols":
      artwork = <>
        <path d="M8 11h42v32H8z" fill={silver} opacity=".52" />
        <rect x="14" y="17" width="42" height="34" rx="2" fill={silver} />
        <path d="M18 22h34v24H18z" fill="#294b65" opacity=".82" />
        <path d="M18 42l10-10 6 5 7-8 11 13" fill={silver} opacity=".9" />
        <circle cx="27" cy="28" r="3" fill={silver} />
        <path d="M17 19h36" stroke="white" strokeOpacity=".55" />
      </>;
      break;
    case "engineering":
      artwork = <>
        <rect x="7" y="21" width="50" height="31" rx="4" fill={silver} />
        <path d="M23 22v-8h18v8" {...line} strokeWidth="4.5" />
        <path d="M8 32h48v5H8z" fill="#294b65" />
        <rect x="16" y="29" width="5" height="12" rx="1" fill={silver} />
        <rect x="43" y="29" width="5" height="12" rx="1" fill={silver} />
        <path d="M12 23h40" stroke="#fff" strokeOpacity=".5" />
      </>;
      break;
    case "operations":
      artwork = <>
        <path d="M27 6h10l2 7 5 2 7-4 7 8-4 6 1 5 6 3v9l-7 2-2 5 4 6-8 6-6-5-5 2-2 6h-9l-2-7-5-2-6 4-7-7 5-7-2-5-6-2v-9l7-2 2-5-4-6 7-7 7 4 5-2z" fill={silver} />
        <circle cx="32" cy="34" r="10" fill="#294b65" />
        <circle cx="32" cy="34" r="6.5" fill={silver} opacity=".72" />
        <path d="M17 18c8-10 22-11 32-1" stroke="#fff" strokeOpacity=".35" fill="none" />
      </>;
      break;
    case "project":
    case "user":
      artwork = <>
        <circle cx="30" cy="20" r="10.5" fill={silver} />
        <path d="M10 52v-7c0-9 9-15 20-15s20 6 20 15v7z" fill={silver} />
        <path d="M45 12c8 1 12 13 3 19 9 2 14 8 13 18H53V43c0-7-4-11-10-14 5-5 5-10 2-17" fill={silver} opacity=".5" />
        <path d="M15 42c7-9 20-9 29 0" fill="none" stroke="white" strokeOpacity=".3" />
      </>;
      break;
    case "gateway":
      artwork = <>
        <path d="M11 55V26a21 21 0 0 1 42 0v29H43V26a11 11 0 0 0-22 0v29z" fill={silver} />
        <path d="M11 28v-2a21 21 0 0 1 42 0v2" fill="none" stroke="#fff" strokeOpacity=".5" />
        <rect x="25" y="31" width="14" height="10" rx="2" fill={silver} />
        <path d="M21 36h22" stroke={silver} strokeWidth="2" />
      </>;
      break;
    case "information":
      artwork = <>
        <circle cx="32" cy="32" r="24" fill={silver} />
        <circle cx="32" cy="20" r="3" fill="#294b65" />
        <path d="M29 28h6v16h4v3H25v-3h4z" fill="#294b65" />
        <circle cx="32" cy="32" r="22" fill="none" stroke="#fff" strokeOpacity=".3" />
      </>;
      break;
    case "connections":
    case "topology":
      artwork = <>
        <g {...line} strokeWidth="3.3"><path d="M32 22v12M13 45v-9h38v9M32 36v9" /></g>
        <rect x="22" y="7" width="20" height="16" rx="2" fill={silver} />
        <rect x="5" y="44" width="16" height="13" rx="1" fill={silver} />
        <rect x="24" y="44" width="16" height="13" rx="1" fill={silver} />
        <rect x="43" y="44" width="16" height="13" rx="1" fill={silver} />
        <path d="M25 10h14v9H25z" fill="#294b65" opacity=".65" />
      </>;
      break;
    case "trace":
      artwork = <g {...line}>
        <circle cx="32" cy="32" r="23" />
        <path d="M15 33h8l4-12 8 22 5-11h10" strokeWidth="3.7" />
      </g>;
      break;
    case "protocol":
      artwork = <>
        <g {...line} strokeWidth="4"><path d="M9 21h42l-8-8M55 43H13l8 8" /></g>
        <circle cx="21" cy="32" r="2" fill={silver} /><circle cx="32" cy="32" r="2" fill={silver} /><circle cx="43" cy="32" r="2" fill={silver} />
      </>;
      break;
    case "routing":
      artwork = <>
        <g {...line} strokeWidth="4"><path d="M11 32h20M31 32l16-17M31 32l16 17" /></g>
        <rect x="5" y="26" width="12" height="12" rx="2" fill={silver} />
        <rect x="45" y="8" width="12" height="12" rx="2" fill={silver} />
        <rect x="45" y="44" width="12" height="12" rx="2" fill={silver} />
      </>;
      break;
    case "source":
      artwork = <>
        <path d="M15 5h25l11 11v43H15z" fill={silver} />
        <path d="M40 5v13h11" fill="#294b65" opacity=".65" />
        <g stroke="#294b65" strokeWidth="2.9" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M26 29l-6 7 6 7M40 29l6 7-6 7M36 26l-6 20" /></g>
      </>;
      break;
    case "shield":
      artwork = <>
        <path d="M32 5c7 6 15 8 23 9v17c0 14-12 23-23 28C21 54 9 45 9 31V14c8-1 16-3 23-9" fill={silver} />
        <path d="M32 12v39c-10-6-17-13-17-22V19c7-1 12-3 17-7" fill="#294b65" opacity=".6" />
        <path d="M23 31l7 7 13-15" stroke="#fff" strokeOpacity=".85" strokeWidth="3" fill="none" />
      </>;
      break;
    case "status":
      artwork = <>
        <path d="M10 8h44v49H10z" fill={silver} />
        <path d="M18 19h6v6h-6zM18 31h6v6h-6zM18 43h6v6h-6z" fill="#294b65" />
        <path d="M29 22h17M29 34h17M29 46h12" stroke="#294b65" strokeWidth="3" />
      </>;
      break;
    case "download":
    case "quickstart":
      artwork = <>
        <path d="M26 6h12v24h12L32 48 14 30h12z" fill={silver} />
        <path d="M10 45v11h44V45" {...line} strokeWidth="4" />
      </>;
      break;
    case "configuration":
      artwork = <>
        <g {...line} strokeWidth="3.6"><path d="M13 7v50M32 7v50M51 7v50" /></g>
        <rect x="6" y="18" width="14" height="10" rx="2" fill={silver} />
        <rect x="25" y="36" width="14" height="10" rx="2" fill={silver} />
        <rect x="44" y="13" width="14" height="10" rx="2" fill={silver} />
      </>;
      break;
    case "monitor":
      artwork = <>
        <rect x="5" y="9" width="54" height="36" rx="3" fill={silver} />
        <path d="M10 14h44v25H10z" fill="#294b65" />
        <path d="M14 29h9l4-8 8 12 5-7h10" stroke={silver} strokeWidth="2.5" fill="none" />
        <path d="M27 45h10v8h9v3H18v-3h9z" fill={silver} />
      </>;
      break;
    case "contribute":
      artwork = <>
        <g {...line} strokeWidth="4"><path d="M17 15v34M47 17c0 19-30 6-30 25" /></g>
        <circle cx="17" cy="12" r="6" fill={silver} /><circle cx="17" cy="51" r="6" fill={silver} /><circle cx="47" cy="13" r="6" fill={silver} />
      </>;
      break;
    case "profile":
      artwork = <>
        <path d="M16 4h32a4 4 0 0 1 4 4v48a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill={silver} />
        <path d="M19 13h26v39H19z" fill="#294b65" opacity=".74" />
        <circle cx="32" cy="27" r="7.5" fill={silver} />
        <path d="M22 52v-5c0-6 4.5-10 10-10s10 4 10 10v5z" fill={silver} />
        <circle cx="32" cy="8.5" r="2.6" fill="#294b65" opacity=".65" />
        <path d="M16 4h32a4 4 0 0 1 4 4v48a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="none" stroke="#fff" strokeOpacity=".38" />
      </>;
      break;
  }

  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={`silver-${id}`} x1="22" y1="4" x2="40" y2="59" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" /><stop offset=".28" stopColor="#e9f2f5" />
          <stop offset=".5" stopColor="#c2d0da" /><stop offset=".55" stopColor="#91a4b5" />
          <stop offset=".85" stopColor="#adbdc9" /><stop offset="1" stopColor="#8194a6" />
        </linearGradient>
      </defs>
      {artwork}
    </svg>
  );
}