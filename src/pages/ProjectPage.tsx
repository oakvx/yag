import { Container, PageMasthead, StatusBadge } from "@/components/Primitives";
import { REPO_LINKS, TREE_URL } from "@/data/repository";
import { RouteLink, useRouter } from "@/router/RouterContext";
import { cn } from "@/utils/cn";

const REPO_LAYOUT = [
  { dir: "host/", desc: "C17 listener, constant-time auth, exact-model routing, scheduler and protocol adapters." },
  { dir: "console/", desc: "Optional React + TypeScript browser UI served statically by the host." },
  { dir: "tests/", desc: "Python contract suites for framing, fuzzing, rate limits, fallback and the mock adapters." },
  { dir: "docs/", desc: "Architecture status, Docker and LAN deployment guides, Codex / Claude Code probe notes." },
  { dir: "scripts/", desc: "Cross-platform Colibri LAN hub manager (lan.py) for private-CA HTTPS setups." },
  { dir: "third_party/yyjson/", desc: "Vendored yyjson 0.12.0 with its original MIT license." },
];

const CONTRIBUTIONS = [
  {
    badge: "Real-model probes",
    title: "Qualify real inference backends",
    body: "Run the isolated probes described in docs/integrations/live-model.md and real-model.md against Ollama, vLLM or llama.cpp, and record exact model IDs and failure modes.",
    href: REPO_LINKS.liveModelDoc,
    link: "Read live-model.md ↗",
  },
  {
    badge: "Protocol diagnostics",
    title: "Report adapter mismatches safely",
    body: "When a Responses or Anthropic client hits a 400 rejection, YAG_TRACE_ANTHROPIC_SHAPE=1 logs allow-listed field and block categories — never prompt text or secrets.",
    href: REPO_LINKS.newIssue,
    link: "Open an issue on GitHub ↗",
  },
  {
    badge: "Host hardening",
    title: "Review HTTP framing and edge cases",
    body: "Inspect socket deadline edge cases and C17 buffer invariants, and extend the byte-level malformed-input corpus in tests/http_fuzz.py.",
    href: `${REPO_LINKS.repo}/blob/main/tests/http_fuzz.py`,
    link: "Inspect tests/http_fuzz.py ↗",
  },
];

export function ProjectPage() {
  const { query, navigate } = useRouter();
  const view = query.view === "contributing" ? "contributing" : "about";

  return (
    <div>
      <PageMasthead
        path="/project"
        eyebrow={view === "about" ? "Open source & scope" : "Contributing"}
        title={
          view === "about" ? (
            <>
              YAG doesn’t think. <em>It decides who gets to ask.</em>
            </>
          ) : (
            <>
              Evidence over <em>compatibility claims.</em>
            </>
          )
        }
        lede={
          view === "about"
            ? "Released under the MIT License at github.com/oakvx/yag. YAG is an experimental engineering foundation for developers who prefer small, inspectable C code and explicit operational boundaries."
            : "Automated tests run against a deterministic mock backend, so the highest-leverage contributions right now are reproducible observations against real inference engines."
        }
        meta={[
          { k: "License", v: "MIT", tone: "moss" },
          { k: "Stage", v: "Experimental · v0.1.0", tone: "amber" },
          { k: "Repository", v: "oakvx/yag" },
        ]}
      />

      <div className="px-5 pt-4 @lg:px-8">
        <div role="group" aria-label="Project view" className="inline-flex rounded-full border border-line-strong p-1 font-mono text-[10.5px] uppercase tracking-[0.12em]">
          {[
            { id: "about", label: "About", to: "/project" },
            { id: "contributing", label: "Contributing", to: "/project?view=contributing" },
          ].map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={view === v.id}
              onClick={() => navigate(v.to)}
              className={cn("cursor-pointer rounded-full px-3.5 py-1.5 transition-colors", view === v.id ? "bg-amber/20 text-white" : "text-faint hover:text-paper")}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <section className="py-6 @lg:py-8">
        <Container>
          {view === "about" ? (
            <div className="grid gap-8 @3xl:grid-cols-12">
              <div className="@3xl:col-span-7">
                <p className="label text-amber">Repository anatomy</p>
                <h2 className="display mt-2 text-2xl text-paper">Small enough to read in an afternoon.</h2>
                <ul className="mt-4 divide-y divide-line border-y border-line">
                  {REPO_LAYOUT.map((item) => (
                    <li key={item.dir} className="py-3">
                      <a href={`${TREE_URL}/${item.dir.replace(/\/$/, "")}`} target="_blank" rel="noreferrer noopener" className="font-mono text-[13px] text-amber hover:underline">
                        {item.dir} ↗
                      </a>
                      <p className="mt-1 text-[13px] leading-relaxed text-muted">{item.desc}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="@3xl:col-span-5">
                <p className="label text-amber">Scope</p>
                <h2 className="display mt-2 text-2xl text-paper">A router, a translator, a gatekeeper.</h2>
                <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
                  “It never runs a model and never executes a tool — and never will. That’s not a limitation. That’s the scope.”
                </p>
                <div className="mt-5 flex flex-wrap gap-2.5">
                  <a href={REPO_LINKS.repo} target="_blank" rel="noreferrer noopener" className="btn btn-primary">
                    github.com/oakvx/yag <span aria-hidden="true">↗</span>
                  </a>
                  <a href={REPO_LINKS.license} target="_blank" rel="noreferrer noopener" className="btn btn-outline">
                    MIT License ↗
                  </a>
                </div>
                <div className="mt-5">
                  <RouteLink to="/status" className="font-mono text-[11px] text-amber hover:underline">
                    See what is implemented and what is not →
                  </RouteLink>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 @3xl:grid-cols-3">
              {CONTRIBUTIONS.map((c) => (
                <div key={c.title} className="flex flex-col rounded-2xl border border-line bg-panel/60 p-4">
                  <StatusBadge tone="mock">{c.badge}</StatusBadge>
                  <h3 className="mt-3 text-[15.5px] font-medium text-paper">{c.title}</h3>
                  <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-muted">{c.body}</p>
                  <a href={c.href} target="_blank" rel="noreferrer noopener" className="mt-3 font-mono text-[11px] text-amber hover:underline">
                    {c.link}
                  </a>
                </div>
              ))}
            </div>
          )}
        </Container>
      </section>
    </div>
  );
}
