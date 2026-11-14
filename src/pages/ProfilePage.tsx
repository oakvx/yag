import { useEffect, useState, useSyncExternalStore } from "react";
import { Container, PageMasthead, StatusBadge } from "@/components/Primitives";
import { REPO_LINKS } from "@/data/repository";
import { RouteLink, useRouter } from "@/router/RouterContext";
import { AUDIO_STORAGE_KEY, xmbAudio } from "@/xmb/audio";
import { CATEGORIES } from "@/xmb/categories";
import { YagEmblem } from "@/xmb/Glyphs";

const PROJECT_FACTS: Array<[string, string]> = [
  ["Project", "YAG — Yet Another Gateway"],
  ["Version", "0.1.0 (CMake project definition)"],
  ["Stage", "Experimental · real-model compatibility unverified"],
  ["License", "MIT · © 2026 YAG contributors"],
  ["Native host", "C17 · POSIX sockets · libcurl · pthreads"],
  ["JSON parser", "yyjson 0.12.0, vendored under third_party/yyjson"],
  ["Console", "React 19 + TypeScript, shipped as one static file"],
  ["Default bind", "127.0.0.1:8080, plain HTTP"],
  ["Credentials", "1 primary key + up to 16 scoped extra keys"],
  ["Model routes", "Up to 16 exact model identifiers"],
  ["Verification", "CTest suites against a deterministic mock upstream"],
];

const NEXT_STEPS = [
  { title: "Source Explorer", sub: "Read the C17 host, the adapters and the contract tests", to: "/source" },
  { title: "Architecture", sub: "The host component by component, with the request path", to: "/architecture" },
  { title: "Project status", sub: "What is implemented, mock-tested or still unverified", to: "/status" },
  { title: "Contributing", sub: "Live-model probes, protocol reports and hardening", to: "/project?view=contributing" },
];

const EXTERNAL_LINKS = [
  { title: "Repository", sub: "github.com/oakvx/yag", href: REPO_LINKS.repo },
  { title: "Architecture status", sub: "docs/architecture/STATUS.md", href: REPO_LINKS.statusDoc },
  { title: "Integration guides", sub: "Codex, Claude Code, Ollama, live models", href: REPO_LINKS.integrationsDoc },
  { title: "Issues", sub: "Reproducible findings are the most useful bug report", href: REPO_LINKS.issues },
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
  const session: Array<[string, string]> = [
    ["Menu position", `${category.label} › ${item.label}`],
    ["Open destination", `${route.label} (${route.path})`],
    ["Viewport", facts.viewport],
    ["Pixel ratio", facts.ratio],
    ["Reduced motion", facts.motion],
    ["Color scheme", facts.scheme],
    ["Pointer", facts.pointer],
    ["Audio", `Music ${prefs.music ? "on" : "off"} · Effects ${prefs.effects ? "on" : "off"} · Volume ${Math.round(prefs.master * 100)}%`],
    ["Stored preferences", facts.stored],
    ["Network activity", "None — this console is a static document"],
  ];

  return (
    <div>
      <PageMasthead
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

      <section className="py-6 @lg:py-8">
        <Container>
          <div className="grid gap-6 @3xl:grid-cols-12">
            {/* Identity */}
            <div className="@3xl:col-span-5">
              <div className="h-full rounded-2xl border border-line bg-panel/60 p-5">
                <div className="flex items-center gap-4">
                  <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-line-strong bg-ink">
                    <YagEmblem size={34} />
                  </span>
                  <div className="min-w-0">
                    <p className="label text-amber">Author &amp; maintainer</p>
                    <h2 className="display mt-1 text-[1.35rem] text-paper">oakvx</h2>
                    <p className="mt-1 font-mono text-[11px] text-faint">MIT · © 2026 YAG contributors</p>
                  </div>
                </div>

                <p className="mt-5 text-[13.5px] leading-relaxed text-muted">
                  “It never runs a model and never executes a tool — and never will. That’s not a limitation. That’s the
                  scope.”
                </p>

                <dl className="mt-5 divide-y divide-line border-y border-line">
                  {[
                    ["Role", "Author, maintainer and issue triager"],
                    ["Response time", "Best effort, asynchronous"],
                    ["Review policy", "Reproducible evidence before compatibility claims"],
                    ["Accepted work", "Probes, protocol reports, host hardening"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex gap-3 py-2">
                      <dt className="w-28 shrink-0 font-mono text-[10.5px] uppercase tracking-[0.1em] text-faint">{label}</dt>
                      <dd className="text-[12.5px] leading-relaxed text-paper">{value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-5 flex flex-wrap gap-2.5">
                  <a href={REPO_LINKS.author} target="_blank" rel="noreferrer noopener" className="btn btn-outline">
                    GitHub profile <span aria-hidden="true">↗</span>
                  </a>
                  <RouteLink to="/project?view=contributing" className="btn btn-amber">
                    How to contribute
                  </RouteLink>
                </div>
              </div>
            </div>

            {/* Project identity */}
            <div className="@3xl:col-span-7">
              <p className="label text-amber">Project identity</p>
              <h2 className="display mt-2 text-2xl text-paper">The same identity the native host ships.</h2>
              <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
                These values are read from the repository — the CMake project definition, the vendored dependencies and
                the configuration reference. They describe the software, not a running instance.
              </p>
              <dl className="mt-5 divide-y divide-line border-y border-line">
                {PROJECT_FACTS.map(([label, value]) => (
                  <div key={label} className="grid gap-1 py-2.5 @2xl:grid-cols-[200px_1fr] @2xl:gap-6">
                    <dt className="text-[12.5px] text-faint">{label}</dt>
                    <dd className="text-[12.5px] leading-relaxed text-paper">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-[12px] text-muted">
                Source:{" "}
                <a href={REPO_LINKS.statusDoc} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                  Architecture and implementation status
                </a>
              </p>
            </div>
          </div>
        </Container>
      </section>

      {/* Session profile */}
      <section className="pb-6 @lg:pb-8">
        <Container>
          <div className="grid gap-6 @3xl:grid-cols-12">
            <div className="@3xl:col-span-7">
              <p className="label text-amber">This session</p>
              <h2 className="display mt-2 text-2xl text-paper">What this browser can prove.</h2>
              <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
                Read from the live page: the position you left the crossbar in, the preferences this console stored, and
                the display it is running on. Nothing here identifies you, and nothing is sent anywhere.
              </p>
              <dl className="mt-5 divide-y divide-line border-y border-line">
                {session.map(([label, value]) => (
                  <div key={label} className="grid gap-1 py-2.5 @2xl:grid-cols-[200px_1fr] @2xl:gap-6">
                    <dt className="text-[12.5px] text-faint">{label}</dt>
                    <dd className="font-mono text-[12px] leading-relaxed text-paper">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="@3xl:col-span-5">
              <div className="rounded-2xl border border-line bg-panel/60 p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="label text-amber">Console state</p>
                  <StatusBadge tone="mock">Local only</StatusBadge>
                </div>
                <ul className="mt-4 space-y-2.5 text-[12.5px] leading-relaxed text-muted">
                  {[
                    "Audio preferences persist in this browser under a single localStorage key.",
                    "The menu cursor is kept in the history state, so Back returns to the position you left.",
                    "This console never calls a gateway endpoint, so no key or prompt can leave the page.",
                    "A running YAG host is not required to read any of this documentation.",
                  ].map((line) => (
                    <li key={line} className="flex gap-2.5">
                      <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-amber/70" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* Where to go next */}
      <section className="pb-8">
        <Container>
          <p className="label text-amber">Continue from here</p>
          <h2 className="display mt-2 text-2xl text-paper">Four doors, none of them locked.</h2>
          <div className="mt-5 grid gap-3 @2xl:grid-cols-4">
            {NEXT_STEPS.map((step) => (
              <RouteLink
                key={step.to}
                to={step.to}
                className="group flex flex-col rounded-2xl border border-line bg-white/[0.03] px-4 py-3.5 transition-colors hover:border-amber/60 hover:bg-amber/[0.08]"
              >
                <span className="text-[14.5px] text-paper">{step.title}</span>
                <span className="mt-1.5 text-[12px] leading-relaxed text-faint">{step.sub}</span>
              </RouteLink>
            ))}
          </div>
          <div className="mt-3 grid gap-3 @2xl:grid-cols-4">
            {EXTERNAL_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer noopener"
                className="group flex flex-col rounded-2xl border border-line bg-white/[0.03] px-4 py-3.5 transition-colors hover:border-amber/60 hover:bg-amber/[0.08]"
              >
                <span className="text-[14.5px] text-paper">
                  {link.title} <span aria-hidden="true" className="text-faint">↗</span>
                </span>
                <span className="mt-1.5 text-[12px] leading-relaxed text-faint">{link.sub}</span>
              </a>
            ))}
          </div>
        </Container>
      </section>
    </div>
  );
}
