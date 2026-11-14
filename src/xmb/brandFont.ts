import { useEffect, useSyncExternalStore } from "react";
import { hasOptionalAsset, publicAsset } from "./assets";

/** Family name of the display face used by the boot wordmark and the identity block. */
export const BRAND_FONT = "YAG Logo";

interface BrandCandidate {
  path: string;
  format: string;
}

/** Optional user-supplied display faces, most specific first. */
const CANDIDATES: BrandCandidate[] = [
  { path: "fonts/PS4-Logo.otf", format: "opentype" },
  { path: "fonts/YAG-Boot-Display.woff2", format: "woff2" },
  { path: "fonts/YAG-Boot-Display.ttf", format: "truetype" },
];

let family: string | null = null;
let started = false;
const listeners = new Set<() => void>();

function publish(next: string | null) {
  family = next;
  listeners.forEach((listener) => listener());
}

/**
 * Load the display face exactly once, through the FontFace API, and share it
 * with every wordmark. A stylesheet @font-face alone leaves the corner logo on
 * the fallback face whenever the file is late or blocked, so the family is
 * applied only once the browser confirms the download.
 */
export function loadBrandFont(): void {
  if (started) return;
  started = true;
  if (typeof FontFace === "undefined" || typeof document === "undefined") return;
  const candidates = CANDIDATES.filter((candidate) => hasOptionalAsset(candidate.path));
  if (!candidates.length) return;
  void (async () => {
    for (const candidate of candidates) {
      try {
        const face = new FontFace(BRAND_FONT, `url("${publicAsset(candidate.path)}")`, {
          weight: "400",
          style: "normal",
        });
        await face.load();
        document.fonts.add(face);
        publish(BRAND_FONT);
        return;
      } catch {
        /* Try the next file, then keep the fallback face. */
      }
    }
  })();
}

export function subscribeBrandFont(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getBrandFont(): string | null {
  return family;
}

/** The brand family once it is ready, null while the fallback face is in use. */
export function useBrandFont(): string | null {
  useEffect(() => { loadBrandFont(); }, []);
  return useSyncExternalStore(subscribeBrandFont, getBrandFont, getBrandFont);
}
