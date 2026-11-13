import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type AnchorHTMLAttributes, type MouseEvent, type ReactNode,
} from "react";
import { usePrefersReducedMotion } from "@/hooks/useInView";
import { locate, validCursor, type MenuCursor } from "@/xmb/categories";
import { getRouteDef, isRoutePath, type RouteDefinition, type RoutePath } from "./routes";

export type TransitionStyle = "right" | "left" | "down" | "up";
export type TransitionPhase = "idle" | "cover" | "reveal";
type Surface = "menu" | "app";
type Journey = "launch" | "return" | "switch";
export interface ParsedLocation { path: RoutePath; query: Record<string, string> }
interface ConsoleHistory { cursor: MenuCursor; depth: number }

function parseLocation(input: string): ParsedLocation {
  const url = new URL(input, window.location.origin === "null" ? "https://yag.local" : window.location.origin);
  const clean = url.pathname.replace(/\/+$/, "") || "/";
  return { path: isRoutePath(clean) ? clean : "/", query: Object.fromEntries(url.searchParams) };
}
export function resolveBrowserLocation(): ParsedLocation {
  if (window.location.hash.startsWith("#/")) return parseLocation(window.location.hash.slice(1));
  const url = new URL(window.location.href);
  const override = url.searchParams.get("route");
  if (override) { url.pathname = override; url.searchParams.delete("route"); }
  return parseLocation(url.pathname + url.search);
}
function surfaceOf(location: ParsedLocation): Surface {
  return location.path === "/" && !location.query.app && !location.query.view ? "menu" : "app";
}
function historyMeta(): ConsoleHistory | null {
  const value = window.history.state?.yagConsole;
  return value?.cursor ? { cursor: validCursor(value.cursor), depth: Number(value.depth) || 0 } : null;
}
function updateSeo(location: ParsedLocation) {
  const def = getRouteDef(location.path);
  const viewTitles: Record<string, string> = {
    system: "System Information", configuration: "Configuration", operations: "Operations",
    quickstart: "Quickstart", contributing: "Contributing",
  };
  const title = viewTitles[location.query.view]
    ? `${viewTitles[location.query.view]} | YAG`
    : surfaceOf(location) === "menu" ? "YAG | Cross Media Environment" : def.seoTitle;
  document.title = title;
  document.querySelector('meta[name="description"]')?.setAttribute("content", def.seoDescription);
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", title);
  document.querySelector('meta[property="og:description"]')?.setAttribute("content", def.seoDescription);
}
interface RouterContextValue {
  path: RoutePath; query: Record<string, string>; route: RouteDefinition; targetRoute: RouteDefinition;
  phase: TransitionPhase; style: TransitionStyle; surface: Surface; journey: Journey;
  menuCursor: MenuCursor; chooseMenu: (cursor: MenuCursor) => void; returnToMenu: () => void;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
  paletteOpen: boolean; setPaletteOpen: (open: boolean) => void;
}
const RouterContext = createContext<RouterContextValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const reduced = usePrefersReducedMotion();
  const initial = useMemo(resolveBrowserLocation, []);
  const firstCursor = useMemo(() => historyMeta()?.cursor ?? locate(initial.path, initial.query), [initial]);
  const [current, setCurrent] = useState(initial);
  const [target, setTarget] = useState(initial);
  const [menuCursor, setMenuCursor] = useState(firstCursor);
  const [phase, setPhase] = useState<TransitionPhase>("idle");
  const [style, setStyle] = useState<TransitionStyle>("right");
  const [journey, setJourney] = useState<Journey>("launch");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const currentRef = useRef(current);
  const menuRef = useRef(menuCursor);
  const timers = useRef<number[]>([]);
  currentRef.current = current;
  menuRef.current = menuCursor;
  const clearTimers = useCallback(() => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
  }, []);
  const chooseMenu = useCallback((cursor: MenuCursor) => {
    const safe = validCursor(cursor);
    menuRef.current = safe;
    setMenuCursor(safe);
    if (surfaceOf(currentRef.current) === "menu") {
      window.history.replaceState({ ...window.history.state, yagConsole: { cursor: safe, depth: 0 } }, "");
    }
  }, []);
  const transition = useCallback((next: ParsedLocation) => {
    clearTimers();
    setPaletteOpen(false);
    const prev = currentRef.current;
    const prevSurface = surfaceOf(prev);
    const nextSurface = surfaceOf(next);
    const kind: Journey = nextSurface === "menu" ? "return" : prevSurface === "menu" ? "launch" : "switch";
    setJourney(kind);
    const a = locate(prev.path, prev.query);
    const b = locate(next.path, next.query);
    setStyle(a.cat !== b.cat ? (b.cat > a.cat ? "right" : "left") : b.item >= a.item ? "down" : "up");
    setTarget(next);
    const commit = () => { currentRef.current = next; setCurrent(next); updateSeo(next); };
    const sameView = prev.path === next.path && prevSurface === nextSurface;
    if (reduced || sameView) { commit(); setPhase("idle"); return; }
    setPhase("cover");
    timers.current.push(window.setTimeout(() => { commit(); setPhase("reveal"); }, 240));
    timers.current.push(window.setTimeout(() => setPhase("idle"), 700));
  }, [clearTimers, reduced]);
  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    const next = parseLocation(to);
    const search = new URLSearchParams(next.query).toString();
    const url = next.path + (search ? `?${search}` : "");
    const prev = currentRef.current;
    const prevSurface = surfaceOf(prev);
    const nextSurface = surfaceOf(next);
    const saved = historyMeta();
    const cursor = prevSurface === "menu" ? menuRef.current : saved?.cursor ?? menuRef.current;
    const depth = nextSurface === "menu" ? 0 : prevSurface === "menu" ? 1 : (saved?.depth ?? 0) > 0 ? saved!.depth + (opts?.replace ? 0 : 1) : 0;
    const state = { ...window.history.state, yagConsole: { cursor, depth } };
    if (window.location.protocol === "file:") window.location.hash = `#${url}`;
    else if (opts?.replace) window.history.replaceState(state, "", url);
    else if (url !== window.location.pathname + window.location.search) window.history.pushState(state, "", url);
    transition(next);
  }, [transition]);
  const returnToMenu = useCallback(() => {
    if (surfaceOf(currentRef.current) === "menu") return;
    const saved = historyMeta();
    if (saved) { menuRef.current = saved.cursor; setMenuCursor(saved.cursor); }
    if (saved && saved.depth > 0) window.history.go(-saved.depth);
    else navigate("/", { replace: true });
  }, [navigate]);
  useEffect(() => {
    if (!historyMeta()) window.history.replaceState({ ...window.history.state, yagConsole: { cursor: firstCursor, depth: 0 } }, "");
    updateSeo(initial);
  }, [firstCursor, initial]);
  useEffect(() => {
    const pop = () => {
      const next = resolveBrowserLocation();
      const saved = historyMeta();
      const cursor = saved?.cursor ?? locate(next.path, next.query);
      menuRef.current = cursor; setMenuCursor(cursor); transition(next);
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("hashchange", pop);
    return () => { clearTimers(); window.removeEventListener("popstate", pop); window.removeEventListener("hashchange", pop); };
  }, [clearTimers, transition]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const editable = el && (el.matches("input, textarea, select") || el.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); setPaletteOpen((v) => !v);
      } else if (paletteOpen && e.key === "Escape") {
        e.preventDefault(); setPaletteOpen(false);
      } else if (!editable && e.key === "/") {
        e.preventDefault(); setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [paletteOpen]);
  const value: RouterContextValue = {
    path: current.path, query: current.query, route: getRouteDef(current.path), targetRoute: getRouteDef(target.path),
    surface: surfaceOf(current), journey, phase, style, menuCursor, chooseMenu, returnToMenu, navigate,
    paletteOpen, setPaletteOpen,
  };
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}
export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter must be used inside RouterProvider");
  return ctx;
}
interface RouteLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> { to: string; onAfterNavigate?: () => void }
export function RouteLink({ to, onClick, onAfterNavigate, children, ...rest }: RouteLinkProps) {
  const { navigate } = useRouter();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault(); navigate(to); onAfterNavigate?.();
  };
  return <a href={to} onClick={handle} {...rest}>{children}</a>;
}
