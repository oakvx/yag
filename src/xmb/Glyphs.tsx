import { cn } from "@/utils/cn";
import type { GlyphName } from "./categories";
import { ConsoleIcon } from "./ConsoleIcons";

/** Keep category glyphs visually identical inside the menu and overview application. */
export function Glyph({
  name,
  className,
  tone = "white",
}: {
  name: GlyphName;
  className?: string;
  tone?: "white" | "current";
}) {
  return <ConsoleIcon name={name} className={cn("shrink-0", className)} tone={tone} />;
}

export function YagEmblem({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className={cn("shrink-0", className)}>
      <path d="M7.5 26V14a8.5 8.5 0 0 1 17 0v12h-4V14a4.5 4.5 0 0 0-9 0v12z" fill="currentColor" />
      <path d="M12 17h8" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="16" cy="17" r="2.2" fill="currentColor" />
    </svg>
  );
}
