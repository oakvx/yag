// Vite expands only the paths here; the files themselves stay external in public/.
// This avoids issuing missing-file requests (and browser console errors) at runtime.
const optionalFiles = new Set(
  Object.keys(import.meta.glob(["/public/*", "/public/**/*"], { query: "?url", import: "default" }))
    .map((path) => path.replace(/^\/public\//, "")),
);

export function hasOptionalAsset(path: string): boolean {
  return optionalFiles.has(path.replace(/^\/+/, ""));
}

/** Resolve optional assets next to the single HTML file or under the Vite base. */
export function publicAsset(path: string): string {
  const clean = path.replace(/^\/+/, "");
  if (window.location.protocol === "file:") return new URL(clean, window.location.href).href;
  const base = import.meta.env.VITE_PUBLIC_BASE || import.meta.env.BASE_URL || "/";
  return new URL(`${base.endsWith("/") ? base : `${base}/`}${clean}`, window.location.origin).href;
}

/** Ignore SPA fallbacks: an HTML index is not an optional SVG/audio file. */
export async function assetExists(path: string, kind: "image" | "audio"): Promise<boolean> {
  try {
    if (!hasOptionalAsset(path)) return false;
    if (window.location.protocol === "file:") return true;
    const result = await fetch(publicAsset(path), { method: "HEAD", cache: "no-store" });
    const type = result.headers.get("content-type") || "";
    return result.ok && !type.includes("text/html") &&
      (type.includes(kind) || type.includes("octet-stream") || type === "");
  } catch {
    return false;
  }
}

