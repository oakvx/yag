import { useId } from "react";
import { cn } from "@/utils/cn";
import type { GlyphName } from "./categories";
import { ConsoleIcon } from "./ConsoleIcons";

/** Keep category glyphs visually identical inside the menu and overview application. */
export function Glyph({
  name,
  className,
  tone = "metal",
}: {
  name: GlyphName;
  className?: string;
  tone?: "metal" | "current";
}) {
  return <ConsoleIcon name={name} className={cn("shrink-0", className)} tone={tone} />;
}

export function YagEmblem({ size = 28, className }: { size?: number; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id={`yag-metal-${id}`} x1="12" y1="4" x2="20" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" /><stop offset=".45" stopColor="#dbe9ef" /><stop offset="1" stopColor="#8aa3b5" />
        </linearGradient>
      </defs>
      <path d="M7.5 26V14a8.5 8.5 0 0 1 17 0v12h-4V14a4.5 4.5 0 0 0-9 0v12z" fill={`url(#yag-metal-${id})`} />
      <path d="M12 17h8" stroke={`url(#yag-metal-${id})`} strokeWidth="1.5" />
      <circle cx="16" cy="17" r="2.2" fill={`url(#yag-metal-${id})`} />
    </svg>
  );
}