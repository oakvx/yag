import { useEffect, useState, useSyncExternalStore } from "react";
import { XmbScreen } from "@/components/XmbScreen";
import type { XmbGlyph } from "@/xmb/XmbList";
import { REPO_LINKS } from "@/data/repository";
import { useRouter } from "@/router/RouterContext";
import { AUDIO_STORAGE_KEY, xmbAudio } from "@/xmb/audio";
import { CATEGORIES } from "@/xmb/categories";

/** Every fact carries the console glyph that stands for it. */
const PROJECT_FACTS: Array<[XmbGlyph, string, string]> = [
  ["gateway", "Project", "YAG — Yet Another Gateway"],
  ["information", "Version", "0.1.0 (CMake project definition)"],
  ["status", "Stage", "Experimental · real-model compatibility unverified"],
  ["source", "License", "MIT · © 2026 YAG contributors"],
  ["operations", "Native host", "C17 · POSIX sockets · libcurl · pthreads"],
  ["protocols", "JSON parser", "yyjson 0.12.0, vendored under third_party/yyjson"],
  ["monitor", "Console", "React 19 + TypeScript, shipped as one static file"],
  ["connections", "Default bind", "127.0.0.1:8080, plain HTTP"],
  ["shield", "Credentials", "1 primary key + up to 16 scoped extra keys"],
  ["routing", "Model routes", "Up to 16 exact model identifiers"],
  ["quickstart", "Verification", "CTest suites against a deterministic mock upstream"],
];

const MAINTAINER_FACTS: Array<[XmbGlyph, string, string]> = [
  ["profile", "Role", "Author, maintainer and issue triager"],
  ["monitor", "Response time", "Best effort, asynchronous"],
  ["shield", "Review policy", "Reproducible evidence before compatibility claims"],
  ["contribute", "Accepted work", "Probes, protocol reports, host hardening"],
];

const NEXT_STEPS: Array<[XmbGlyph, string, string, string]> = [
  ["source", "Source Explorer", "Read the C17 host, the adapters and the contract tests", "/source"],
  ["topology", "Architecture", "The host component by component, with the request path", "/architecture"],
  ["status", "Project status", "What is implemented, mock-tested or still unverified", "/status"],
  ["contribute", "Contributing", "Live-model probes, protocol reports and hardening", "/project?view=contributing"],
];

const EXTERNAL_LINKS: Array<[XmbGlyph, string, string, string]> = [
  ["source", "Repository", "github.com/oakvx/yag", REPO_LINKS.repo],
  ["information", "Architecture status", "docs/architecture/STATUS.md", REPO_LINKS.statusDoc],
  ["protocols", "Integration guides", "Codex, Claude Code, Ollama, live models", REPO_LINKS.integrationsDoc],
  ["connections", "Issues", "Reproducible findings are the most useful bug report", REPO_LINKS.issues],
];

const CONSOLE_NOTES = [
  "Audio preferences persist in this browser under a single localStorage key.",
  "The menu cursor is kept in the history state, so Back returns to the position you left.",
  "This console never calls a gateway endpoint, so no key or prompt can leave the page.",
  "A running YAG host is not required to read any of this documentation.",
];

interface SessionFacts {
  viewport: string;
  ratio: string;
  motion: string;
  scheme: string;
  pointer: string;
  stored: string;
}

const UNKNOWN: SessionFacts = {
  viewport: "—",
  ratio: "—",
  motion: "—",
  scheme: "—",
  pointer: "—",
  stored: "—",
};

/** Facts about this browser only. Nothing is requested from a gateway or a server. */
function readSessionFacts(): SessionFacts {
  if (typeof window === "undefined") return UNKNOWN;
  let stored = "Defaults only";
  try {
    stored = window.localStorage.getItem(AUDIO_STORAGE_KEY) ? "Saved in this browser" : "Defaults only";
  } catch {
    stored = "Storage unavailable";
  }
  return {
    viewport: `${window.innerWidth} × ${window.innerHeight} CSS px`,
    ratio: `${window.devicePixelRatio}×`,
    motion: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "Reduced" : "Full",
    scheme: window.matchMedia("(prefers-color-scheme: light)").matches ? "Light requested · dark applied" : "Dark",
    pointer: window.matchMedia("(pointer: coarse)").matches ? "Coarse · touch" : "Fine · mouse, trackpad, keyboard",
    stored,
  };
}

export function ProfilePage() {
  const { route, menuCursor } = useRouter();
  const prefs = useSyncExternalStore(xmbAudio.subscribe, xmbAudio.getPreferences, xmbAudio.getPreferences);
  const [facts, setFacts] = useState<SessionFacts>(UNKNOWN);

  useEffect(() => {
    const update = () => setFacts(readSessionFacts());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const category = CATEGORIES[menuCursor.cat];
  const item = category.items[menuCursor.item];
  const session: Array<[XmbGlyph, string, string]> = [
    ["home", "Menu position", `${category.label} › ${item.label}`],
    ["gateway", "Open destination", `${route.label} (${route.path})`],
    ["monitor", "Viewport", facts.viewport],
    ["configuration", "Pixel ratio", facts.ratio],
    ["quickstart", "Reduced motion", facts.motion],
    ["explore", "Color scheme", facts.scheme],
    ["link", "Pointer", facts.pointer],
    ["protocols", "Audio", `Music ${prefs.music ? "on" : "off"} · Effects ${prefs.effects ? "on" : "off"} · Volume ${Math.round(prefs.master * 100)}%`],
    ["profile", "Stored preferences", facts.stored],
    ["shield", "Network activity", "None — this console is a static document"],
  ];

  const rows = (facts: Array<[XmbGlyph, string, string]>) => facts.map(([icon, title, value]) => ({ key: title, icon, title, value, description: value }));
  return <XmbScreen document={<p>YAG is maintained by oakvx. This page brings together the maintainer details, project specifications and facts about the current browser session. Nothing here identifies you or calls a gateway.</p>} subtitle="Maintainer, project identity and facts about this browser session." testId="profile" sections={[
    { id: "maintainer", label: "Author & maintainer", entries: [
      { key: "author", icon: "project", title: "Maintainer", value: "oakvx", description: "Author and maintainer of YAG. No account is required to use this console." },
      ...rows(MAINTAINER_FACTS),
      { key: "author-link", title: "GitHub profile", value: "oakvx", href: REPO_LINKS.author },
      { key: "contribute", title: "How to contribute", to: "/project?view=contributing" },
    ], panel: <p>“It never runs a model and never executes a tool — and never will. That’s not a limitation. That’s the scope.”</p> },
    { id: "identity", label: "Project identity", entries: rows(PROJECT_FACTS), panel: <p>These values describe the repository: the CMake project definition, vendored dependencies and configuration reference. They do not describe a running instance. Architecture and implementation status is available in the repository.</p> },
    { id: "session", label: "This session", entries: rows(session), panel: <p>Read from the live page and preferences stored in this browser. Nothing here identifies you, and nothing is sent anywhere.</p> },
    { id: "console", label: "Console state", entries: CONSOLE_NOTES.map((text, i) => ({ key: String(i), title: ["Audio preferences", "Cursor memory", "Network activity", "Offline documentation"][i], value: "Local only", description: text, panel: <p>{text}</p> })) },
    { id: "continue", label: "Continue", entries: [
      ...NEXT_STEPS.map(([icon, title, sub, to]) => ({ key: to, icon, title, sub, description: sub, to: to })),
      ...EXTERNAL_LINKS.map(([icon, title, sub, href]) => ({ key: href, icon, title, sub, href, description: sub })),
    ] },
  ]} />;
}
