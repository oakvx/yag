import { useState } from "react";
import { Container, PageMasthead, StatusBadge } from "@/components/Primitives";
import { BLOB_URL, REPO_LINKS } from "@/data/repository";
import { cn } from "@/utils/cn";

type MatrixStatus = "implemented" | "mock" | "unverified" | "absent" | "scope";

interface StatusEntry {
  id: string;
  component: string;
  subsystem: string;
  status: MatrixStatus;
  statusText: string;
  summary: string;
  evidence: string;
  evidenceHref: string;
  caveats: string;
}

const STATUS_ENTRIES: StatusEntry[] = [
  {
    id: "host-listener",
    component: "Bounded POSIX HTTP/1.x Host & Pre-Body Auth",
    subsystem: "Host Core",
    status: "implemented",
    statusText: "Implemented",
    summary: "32-connection cap, 16 KiB header / 1 MiB body caps, monotonic deadlines, constant-time key check, SIGINT/SIGTERM drain.",
    evidence: "host/src/http/server.c · tests/integration.py · tests/http_fuzz.py",
    evidenceHref: `${BLOB_URL}/host/src/http/server.c`,
    caveats: "Not an independently audited HTTP server; no keep-alive or chunked request bodies.",
  },
  {
    id: "chat-proxy",
    component: "OpenAI Chat Completions, Completions & Embeddings Proxy",
    subsystem: "Protocols",
    status: "implemented",
    statusText: "Implemented",
    summary: "Transparent passthrough with SSE streaming, tool_calls relay, and 100 ms client-EOF cancellation.",
    evidence: "host/src/inference/openai.c · tests/integration.py",
    evidenceHref: `${BLOB_URL}/host/src/inference/openai.c`,
    caveats: "YAG does not validate OpenAI model semantics; actual tool/embedding behavior depends on the upstream.",
  },
  {
    id: "model-routing",
    component: "Exact-Model Routing (≤ 16 Routes) & key_env Secrets",
    subsystem: "Routing",
    status: "implemented",
    statusText: "Implemented",
    summary: "Startup-validated YAG_MODEL_ROUTES JSON, host-only secret resolution, opt-in circuit breaker, and pre-response connect fallback.",
    evidence: "host/src/core/config.c · tests/circuit_breaker.py · tests/fallback.py",
    evidenceHref: `${BLOB_URL}/host/src/core/config.c`,
    caveats: "Static route IDs in /v1/models do not guarantee backend availability or capability.",
  },
  {
    id: "scoped-keys",
    component: "Scoped Extra Keys & Fixed-Window Rate Limiting",
    subsystem: "Security",
    status: "implemented",
    statusText: "Implemented",
    summary: "Up to 16 extra keys with positional scopes (all, inference, models, monitor) and 60s 429 Retry-After windows.",
    evidence: "host/src/http/server.c · tests/rate_limit.py",
    evidenceHref: `${BLOB_URL}/tests/rate_limit.py`,
    caveats: "Static env keys cannot be revoked without restarting the gateway.",
  },
  {
    id: "react-console",
    component: "Self-Hosted React Console & Symlink-Safe Asset Serving",
    subsystem: "Console",
    status: "implemented",
    statusText: "Implemented",
    summary: "Session-only key storage, status/model inspection, cancellable text chat, and copyable curl commands.",
    evidence: "console/src/main.tsx · tests/control_plane.py",
    evidenceHref: `${BLOB_URL}/console/src/main.tsx`,
    caveats: "Browser playground handles text chat only — API clients execute tools themselves.",
  },
  {
    id: "responses-mock",
    component: "OpenAI Responses Stateless Subset Adapter",
    subsystem: "Protocols",
    status: "mock",
    statusText: "Mock-Tested",
    summary: "Translates text, instructions, function tools, and namespace functions to Chat; reconstructs numbered SSE events.",
    evidence: "host/src/protocols/openai_responses/ · tests/responses.py",
    evidenceHref: `${BLOB_URL}/tests/responses.py`,
    caveats: "Pinned Codex CLI 0.167.0 completed text + shell-tool cycles against a deterministic mock backend only; web_search and stateful store:true are unsupported.",
  },
  {
    id: "anthropic-mock",
    component: "Anthropic Messages Bounded Adapter",
    subsystem: "Protocols",
    status: "mock",
    statusText: "Mock-Tested",
    summary: "Translates text, system blocks, and function tool_use / tool_result in non-streaming and SSE modes.",
    evidence: "host/src/protocols/anthropic/ · tests/anthropic.py",
    evidenceHref: `${BLOB_URL}/tests/anthropic.py`,
    caveats: "Claude Code CLI completed streaming text + local Read tool against an isolated mock backend only; no multimodal, prompt caching, native thinking, or count_tokens.",
  },
  {
    id: "real-models",
    component: "Live Inference Model & Full Agent CLI Compatibility",
    subsystem: "Qualification",
    status: "unverified",
    statusText: "Real-Model Unverified",
    summary: "End-to-end compatibility of Codex CLI, Claude Code, and multi-turn tool replay against real model servers.",
    evidence: "docs/integrations/live-model.md · docs/integrations/real-model.md",
    evidenceHref: REPO_LINKS.liveModelDoc,
    caveats: "Explicitly unverified. Different inference engines serialize tool deltas and finish reasons differently.",
  },
  {
    id: "tls-audit",
    component: "Native TLS, CORS, Audit Logging & Encrypted Secret Store",
    subsystem: "Security",
    status: "absent",
    statusText: "Not Implemented",
    summary: "Transport encryption, browser cross-origin policies, persistent request audit trails, and secret vaults.",
    evidence: "docs/architecture/STATUS.md",
    evidenceHref: REPO_LINKS.statusDoc,
    caveats: "Must be supplied externally via a trusted reverse proxy (such as Caddy in the LAN stack) and host service manager.",
  },
  {
    id: "inference-tools",
    component: "Model Inference Execution & Server-Side Tool Execution",
    subsystem: "Scope",
    status: "scope",
    statusText: "Out of Scope",
    summary: "Running neural weights, hosting built-in web_search, or executing client function tools.",
    evidence: "README.md · The idea",
    evidenceHref: REPO_LINKS.readme,
    caveats: "Permanent architectural boundary: YAG will never run models or execute tools.",
  },
];

const FILTERS: Array<{ id: "all" | MatrixStatus; label: string }> = [
  { id: "all", label: "All Entries (10)" },
  { id: "implemented", label: "Implemented" },
  { id: "mock", label: "Mock-Tested" },
  { id: "unverified", label: "Real-Model Unverified" },
  { id: "absent", label: "Not Implemented" },
  { id: "scope", label: "Out of Scope" },
];

export function StatusPage() {
  const [filter, setFilter] = useState<"all" | MatrixStatus>("all");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({
    "responses-mock": true,
    "real-models": true,
  });

  const visible =
    filter === "all" ? STATUS_ENTRIES : STATUS_ENTRIES.filter((e) => e.status === filter);

  const toggle = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div>
      <PageMasthead
        path="/status"
        eyebrow="Chapter 08 · Qualification Ledger"
        title={
          <>
            Implemented, mock-tested, <em>and unverified — kept distinct.</em>
          </>
        }
        lede="No arbitrary readiness percentages. Expand any row in the engineering ledger below to inspect the exact C source or Python test suite backing it, alongside its current operational caveats."
        meta={[
          { k: "Release stage", v: "0.1.0 Experimental", tone: "amber" },
          { k: "Automated tests", v: "15 CTest suites (mock upstream)", tone: "moss" },
          { k: "Live CLI proof", v: "Unverified on real models", tone: "rust" },
        ]}
      />

      <section className="py-6 @lg:py-8">
        <Container>
          {/* Filter Bar */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border border-line bg-panel px-4 py-3">
            <div role="tablist" aria-label="Filter status rows" className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={cn(
                    "border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.13em] transition-colors cursor-pointer",
                    filter === f.id
                      ? "border-amber bg-amber/15 text-paper"
                      : "border-line text-faint hover:text-paper",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <a
              href={REPO_LINKS.statusDoc}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-[10.5px] text-amber hover:underline"
            >
              Read docs/architecture/STATUS.md ↗
            </a>
          </div>

          {/* Expandable Ledger */}
          <div className="divide-y divide-line border border-line-strong bg-panel">
            {visible.map((row) => {
              const isOpen = !!expandedIds[row.id];
              return (
                <div key={row.id} className="transition-colors hover:bg-paper/[0.015]">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggle(row.id)}
                    className="grid w-full items-center gap-3 px-4 py-4 text-left @lg:grid-cols-12 @lg:px-6 cursor-pointer"
                  >
                    <div className="@lg:col-span-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                      {row.subsystem}
                    </div>
                    <div className="@lg:col-span-6 text-[14.5px] font-medium text-paper">{row.component}</div>
                    <div className="@lg:col-span-3">
                      <StatusBadge tone={row.status}>{row.statusText}</StatusBadge>
                    </div>
                    <div className="@lg:col-span-1 text-right font-mono text-[12px] text-amber">
                      {isOpen ? "−" : "+"}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-line bg-[rgba(3,12,34,0.62)] px-4 py-4 @lg:px-6">
                      <div className="grid gap-6 @3xl:grid-cols-12">
                        <div className="@3xl:col-span-6">
                          <p className="label text-faint">Verified Behavior</p>
                          <p className="mt-1.5 text-[13.5px] leading-relaxed text-paper/90">{row.summary}</p>
                        </div>
                        <div className="@3xl:col-span-6 @3xl:border-l @3xl:border-line @3xl:pl-6">
                          <p className="label text-rust">Caveats & Unverified Boundaries</p>
                          <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{row.caveats}</p>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 font-mono text-[10.5px]">
                        <span className="text-faint">Evidence: {row.evidence}</span>
                        <a
                          href={row.evidenceHref}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-amber hover:underline"
                        >
                          Inspect in Repository ↗
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Container>
      </section>
    </div>
  );
}
