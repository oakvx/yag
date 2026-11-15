import { useSyncExternalStore } from "react";

export type TrophyGrade = "bronze" | "silver" | "gold" | "platinum";

export interface TrophyDef {
  id: string;
  grade: TrophyGrade;
  title: string;
  text: string;
  /** A hidden trophy shows neither its name nor its condition until it is earned. */
  hidden?: boolean;
}

export const TROPHIES: readonly TrophyDef[] = [
  { id: "boot", grade: "bronze", title: "Cold Start", text: "Start the console and reach the menu." },
  { id: "opener", grade: "bronze", title: "First Contact", text: "Open any application from the menu." },
  { id: "options", grade: "bronze", title: "Third Button", text: "Open the options panel on a destination." },
  { id: "courier", grade: "bronze", title: "Courier", text: "Copy the link to a destination." },
  { id: "board", grade: "bronze", title: "Stay Informed", text: "Open the information board." },
  { id: "jump", grade: "bronze", title: "Teleport", text: "Search the destinations with Quick Jump (/ or Ctrl+K)." },
  { id: "atmosphere", grade: "silver", title: "Atmosphere", text: "Confirm a wallpaper atmosphere in Theme Settings." },
  { id: "handson", grade: "silver", title: "Hands On", text: "Move through the console with a game controller." },
  { id: "cartographer", grade: "gold", title: "Cartographer", text: "Visit every documentation page." },
  { id: "service", grade: "gold", title: "Service Mode", text: "Find the hidden service screen.", hidden: true },
  { id: "complete", grade: "platinum", title: "Complete Set", text: "Unlock every other trophy." },
];

/** The pages the Cartographer trophy asks for. */
export const DOC_PAGES: readonly string[] = [
  "/problem", "/architecture", "/lifecycle", "/protocols", "/routing", "/source", "/security", "/status", "/deploy",
];

export interface TrophyState {
  unlocked: Record<string, number>;
  visited: string[];
}

const KEY = "yag-xmb-trophies-v1";

function read(): TrophyState {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "null") as Partial<TrophyState> | null;
    const unlocked: Record<string, number> = {};
    if (parsed?.unlocked && typeof parsed.unlocked === "object") {
      for (const trophy of TROPHIES) {
        const at = (parsed.unlocked as Record<string, unknown>)[trophy.id];
        if (typeof at === "number" && Number.isFinite(at)) unlocked[trophy.id] = at;
      }
    }
    const visited = Array.isArray(parsed?.visited)
      ? parsed.visited.filter((path): path is string => typeof path === "string" && DOC_PAGES.includes(path))
      : [];
    return { unlocked, visited };
  } catch {
    return { unlocked: {}, visited: [] };
  }
}

let state: TrophyState = read();
const listeners = new Set<() => void>();
const unlockListeners = new Set<(def: TrophyDef) => void>();

function commit(next: TrophyState) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* optional */ }
  listeners.forEach((listener) => listener());
}

export function unlockTrophy(id: string): void {
  if (state.unlocked[id]) return;
  const def = TROPHIES.find((trophy) => trophy.id === id);
  if (!def) return;
  commit({ ...state, unlocked: { ...state.unlocked, [id]: Date.now() } });
  unlockListeners.forEach((listener) => listener(def));
  if (id !== "complete" && TROPHIES.every((trophy) => trophy.id === "complete" || state.unlocked[trophy.id])) {
    unlockTrophy("complete");
  }
}

export function recordVisit(path: string): void {
  if (!DOC_PAGES.includes(path) || state.visited.includes(path)) return;
  commit({ ...state, visited: [...state.visited, path] });
  if (DOC_PAGES.every((page) => state.visited.includes(page))) unlockTrophy("cartographer");
}

export function subscribeUnlocks(listener: (def: TrophyDef) => void): () => void {
  unlockListeners.add(listener);
  return () => { unlockListeners.delete(listener); };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useTrophyState(): TrophyState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
