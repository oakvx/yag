import { REPO_LINKS } from "@/data/repository";
import type { RoutePath } from "@/router/routes";

export type GlyphName = "home" | "explore" | "protocols" | "engineering" | "operations" | "project";
export type ItemIcon = "gateway" | "information" | "connections" | "topology" | "trace" | "protocol" | "routing" | "source" | "shield" | "status" | "download" | "configuration" | "monitor" | "quickstart" | "user" | "globe" | "contribute" | "profile";
export interface MenuCursor { cat: number; item: number }
export interface XmbItem {
  id: string; code: string; label: string; sub: string; detail: string; icon: ItemIcon;
  to?: RoutePath; query?: string; href?: string;
}
export interface XmbCategory {
  id: string; label: string; glyph: GlyphName; tagline: string; items: XmbItem[];
}
export const CATEGORIES: XmbCategory[] = [
  { id: "home", label: "Home", glyph: "home", tagline: "YAG system", items: [
    { id: "overview", code: "00", label: "Gateway Overview", icon: "gateway", sub: "One local endpoint. Your inference servers.", detail: "Explore YAG, an experimental self-hosted inference gateway.", to: "/", query: "app=overview" },
    { id: "information", code: "SYS", label: "System Information", icon: "information", sub: "Native host, request limits and project information.", detail: "Repository specifications, not live server telemetry.", to: "/", query: "view=system" },
  ]},
  { id: "network", label: "Network", glyph: "explore", tagline: "Explore the system", items: [
    { id: "problem", code: "01", label: "The Problem", icon: "connections", sub: "From fragmented endpoints to a single gateway.", detail: "Compare direct client connections with the YAG topology.", to: "/problem" },
    { id: "architecture", code: "02", label: "Architecture", icon: "topology", sub: "Explore the native host, one component at a time.", detail: "An interactive schematic of the C17 request path.", to: "/architecture" },
    { id: "lifecycle", code: "03", label: "Request Lifecycle", icon: "trace", sub: "Follow a request from admission to response.", detail: "A deterministic local demonstration. No network calls.", to: "/lifecycle" },
  ]},
  { id: "applications", label: "Applications", glyph: "protocols", tagline: "Protocols and destinations", items: [
    { id: "protocols", code: "04", label: "Protocol Explorer", icon: "protocol", sub: "Inspect the boundaries between three request formats.", detail: "Chat forwarding and bounded Responses / Messages adapters.", to: "/protocols" },
    { id: "routing", code: "05", label: "Model Routing", icon: "routing", sub: "Select a model. Inspect its exact-match destination.", detail: "A local simulator for YAG_MODEL_ROUTES and key_env.", to: "/routing" },
  ]},
  { id: "system", label: "System", glyph: "engineering", tagline: "Engineering and qualification", items: [
    { id: "source", code: "06", label: "Source Explorer", icon: "source", sub: "Read the implementation behind the interface.", detail: "Repository-linked C17, CMake and mock contract tests.", to: "/source" },
    { id: "security", code: "07", label: "Security", icon: "shield", sub: "Understand the host's trust boundaries.", detail: "What is enforced, what is absent, and what remains your responsibility.", to: "/security" },
    { id: "status", code: "08", label: "Project Status", icon: "status", sub: "Implemented. Mock-tested. Real-model unverified.", detail: "An evidence-based qualification ledger for the experimental gateway.", to: "/status" },
  ]},
  { id: "settings", label: "Settings", glyph: "operations", tagline: "Deployment and operations", items: [
    { id: "deploy", code: "09", label: "Deployment", icon: "download", sub: "Build the binary and connect your upstream.", detail: "A guided, copyable runbook from the repository documentation.", to: "/deploy" },
    { id: "configuration", code: "CFG", label: "Configuration", icon: "configuration", sub: "Inspect startup variables and host-side credentials.", detail: "A reference, not a connection to a running gateway.", to: "/deploy", query: "view=configuration" },
    { id: "operations", code: "OPS", label: "Operations", icon: "monitor", sub: "Know where to check health and provider state.", detail: "Authenticated inspection endpoints and operational boundaries.", to: "/deploy", query: "view=operations" },
    { id: "quickstart", code: "QS", label: "Quickstart", icon: "quickstart", sub: "Install, compile, start and verify on loopback.", detail: "Four documented steps. No credentials required by this website.", to: "/deploy", query: "view=quickstart" },
  ]},
  { id: "users", label: "Users", glyph: "project", tagline: "Open source", items: [
    { id: "profile", code: "PRF", label: "Profile", icon: "profile", sub: "Maintainer, project identity and this session.", detail: "Who builds YAG, and what this browser can prove.", to: "/profile" },
    { id: "about", code: "10", label: "About YAG", icon: "user", sub: "Yet Another Gateway. Deliberately small in scope.", detail: "Experimental software. MIT licensed. By oakvx.", to: "/project" },
    { id: "github", code: "WEB", label: "GitHub", icon: "globe", sub: "github.com/oakvx/yag", detail: "Open the source repository in a new browser tab.", href: REPO_LINKS.repo },
    { id: "contributing", code: "PR", label: "Contributing", icon: "contribute", sub: "Help turn reproducible findings into better software.", detail: "Real-model probes, protocol reports and host hardening.", to: "/project", query: "view=contributing" },
  ]},
];
export function viewKey(query: Record<string, string> = {}): string {
  return query.view ? `view=${query.view}` : query.app ? `app=${query.app}` : "";
}
export function itemTarget(item: XmbItem): string | null {
  return item.to ? `${item.to}${item.query ? `?${item.query}` : ""}` : null;
}
export function locate(path: RoutePath, query: Record<string, string> = {}): MenuCursor {
  const key = viewKey(query);
  let fallback: MenuCursor | null = null;
  for (let c = 0; c < CATEGORIES.length; c++) {
    for (let i = 0; i < CATEGORIES[c].items.length; i++) {
      const it = CATEGORIES[c].items[i];
      if (it.to !== path) continue;
      if ((it.query ?? "") === key) return { cat: c, item: i };
      fallback ??= { cat: c, item: i };
    }
  }
  return fallback ?? { cat: 0, item: 0 };
}
export function categoryIndexForPath(path: RoutePath): number { return locate(path).cat; }
export function itemIndexForPath(path: RoutePath): number { return locate(path).item; }
export function validCursor(cursor: MenuCursor): MenuCursor {
  const cat = Math.max(0, Math.min(CATEGORIES.length - 1, Number(cursor.cat) || 0));
  const item = Math.max(0, Math.min(CATEGORIES[cat].items.length - 1, Number(cursor.item) || 0));
  return { cat, item };
}
