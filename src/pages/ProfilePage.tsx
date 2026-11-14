import { useEffect, useState, useSyncExternalStore } from "react";
import { Container, PageMasthead, StatusBadge } from "@/components/Primitives";
import { XmbAvatar, XmbColumn, XmbRow, XmbTile, type XmbGlyph } from "@/components/XmbSurface";
import { REPO_LINKS } from "@/data/repository";
import { RouteLink, useRouter } from "@/router/RouterContext";
import { AUDIO_STORAGE_KEY, xmbAudio } from "@/xmb/audio";
import { CATEGORIES } from "@/xmb/categories";
import { YagEmblem } from "@/xmb/Glyphs";

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

  return (
    <div>
      <PageMasthead
        className="xmb-masthead"
        path="/profile"
        eyebrow="Profile"
        title={
          <>
            Who builds YAG, <em>and what this session is.</em>
          </>
        }
        lede="YAG has no accounts and this console keeps no server-side state. The profile below is therefore honest about its two halves: the maintainer and the project identity that live in the repository, and the handful of facts this browser can prove about itself."
        meta={[
          { k: "Maintainer", v: "oakvx", tone: "amber" },
          { k: "License", v: "MIT", tone: "moss" },
          { k: "Stage", v: "Experimental" },
          { k: "Telemetry", v: "None" },
        ]}
      />

      {/* Maintainer and project identity */}
      <section className="py-5 @lg:py-6">
        <Container>
          <div className="xmb-page-grid">
            <div className="xmb-span-5">
              <XmbColumn icon="project" title="Author & maintainer" note="oakvx">
                <div className="px-4 py-4">
                  <div className="flex items-center gap-4">
                    <XmbAvatar />
                    <div className="min-w-0">
                      <p className="label text-amber">Maintainer</p>
                      <h3 className="xmb-tile-title mt-1 text-[1.35rem]">oakvx</h3>
                      <p className="mt-1 font-mono text-[11px] text-faint">MIT · © 2026 YAG contributors</p>
                    </div>
                  </div>

                  <p className="xmb-quote mt-5">
                    “It never runs a model and never executes a tool — and never will. That’s not a limitation. That’s the
                    scope.”
                  </p>

                  <dl className="mt-4">
                    {MAINTAINER_FACTS.map(([icon, label, value]) => (
                      <XmbRow key={label} icon={icon} label={label}>
                        {value}
                      </XmbRow>
                    ))}
                  </dl>

                  <div className="mt-4 flex flex-wrap gap-2.5">
                    <a href={REPO_LINKS.author} target="_blank" rel="noreferrer noopener" className="btn btn-outline">
                      GitHub profile <span aria-hidden="true">↗</span>
                    </a>
                    <RouteLink to="/project?view=contributing" className="btn btn-amber">
                      How to contribute
                    </RouteLink>
                  </div>
                </div>
              </XmbColumn>
            </div>

            <div className="xmb-span-7">
              <XmbColumn
                icon="information"
                title="Project identity"
                note={`${PROJECT_FACTS.length} facts`}
                lede="The same identity the native host ships."
              >
                <div className="flex items-start gap-3 px-4 pt-4">
                  <YagEmblem size={26} className="mt-0.5 shrink-0 opacity-80" />
                  <p className="text-[13px] leading-[1.65] text-muted">
                    These values are read from the repository — the CMake project definition, the vendored dependencies and
                    the configuration reference. They describe the software, not a running instance.
                  </p>
                </div>
                <dl className="mt-3 pb-1">
                  {PROJECT_FACTS.map(([icon, label, value]) => (
                    <XmbRow key={label} icon={icon} label={label}>
                      {value}
                    </XmbRow>
                  ))}
                </dl>
                <p className="px-4 pb-4 pt-3 text-[12px] text-muted">
                  Source:{" "}
                  <a href={REPO_LINKS.statusDoc} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                    Architecture and implementation status
                  </a>
                </p>
              </XmbColumn>
            </div>
          </div>
        </Container>
      </section>

      {/* Session profile */}
      <section className="pb-5 @lg:pb-6">
        <Container>
          <div className="xmb-page-grid">
            <div className="xmb-span-8">
              <XmbColumn icon="monitor" title="This session" note="Live read" lede="What this browser can prove.">
                <p className="px-4 pt-4 text-[13px] leading-[1.65] text-muted">
                  Read from the live page: the position you left the crossbar in, the preferences this console stored, and
                  the display it is running on. Nothing here identifies you, and nothing is sent anywhere.
                </p>
                <dl className="mt-3 pb-1">
                  {session.map(([icon, label, value]) => (
                    <XmbRow key={label} icon={icon} label={label}>
                      {value}
                    </XmbRow>
                  ))}
                </dl>
              </XmbColumn>
            </div>

            <div className="xmb-span-4">
              <XmbColumn icon="operations" title="Console state" note={<StatusBadge tone="mock">Local only</StatusBadge>}>
                <div className="pb-1">
                  {CONSOLE_NOTES.map((line) => (
                    <p key={line} className="xmb-note">
                      <span>{line}</span>
                    </p>
                  ))}
                </div>
              </XmbColumn>
            </div>
          </div>
        </Container>
      </section>

      {/* Where to go next */}
      <section className="pb-8">
        <Container>
          <div className="xmb-page-grid">
            <div className="xmb-span-7">
              <XmbColumn icon="quickstart" title="Continue from here" note="Internal" lede="Four doors, none of them locked.">
                <div className="xmb-tile-grid p-3">
                  {NEXT_STEPS.map(([icon, title, sub, to]) => (
                    <XmbTile key={to} icon={icon} title={title} sub={sub} to={to} />
                  ))}
                </div>
              </XmbColumn>
            </div>

            <div className="xmb-span-5">
              <XmbColumn icon="link" title="Elsewhere" note="External">
                <div className="xmb-tile-grid p-3">
                  {EXTERNAL_LINKS.map(([icon, title, sub, href]) => (
                    <XmbTile key={href} icon={icon} title={title} sub={sub} href={href} />
                  ))}
                </div>
              </XmbColumn>
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}
