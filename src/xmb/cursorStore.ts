import { validCursor, type MenuCursor } from "./categories";

/** The crossbar remembers where it was left, the way the console does. */
const KEY = "yag-xmb-cursor-v1";

export function readStoredCursor(): MenuCursor | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<MenuCursor> | null;
    if (typeof value?.cat !== "number" || typeof value?.item !== "number") return null;
    return validCursor({ cat: value.cat, item: value.item });
  } catch {
    return null;
  }
}

export function writeStoredCursor(cursor: MenuCursor): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cursor));
  } catch {
    /* Storage unavailable (private mode, file://): the position simply does not persist. */
  }
}
