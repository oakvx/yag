import { useState } from "react";
import { XmbRow } from "@/components/XmbRow";
import { XmbScreen, XmbSectionLabel } from "@/components/XmbScreen";
import { BLOB_URL, REPO_LINKS } from "@/data/repository";
import { PROJECT_FEATURES, PROJECT_REVIEW } from "@/data/projectKnowledge";

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
    summary: "Session-only key storage, status/model inspection, text chat and a local operator Control page for managed clients, providers and available resource telemetry.",
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
    component: "Native TLS, CORS & Encrypted Live Secret Store",
    subsystem: "Security",
    status: "absent",
    statusText: "Not Implemented",
    summary: "Native transport encryption, configurable browser cross-origin policies and an encrypted live secret vault remain absent. A separate opt-in private administrative event trail is implemented.",
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
  ...PROJECT_FEATURES.map(feature => ({ id: feature.id, component: feature.title, subsystem: feature.subsystem, status: "implemented" as const, statusText: "Implemented", summary: feature.summary, caveats: feature.boundary, evidence: feature.path, evidenceHref: feature.href })),
];

const FILTERS: Array<{ id: "all" | MatrixStatus; label: string }> = [
  { id: "all", label: `All entries (${STATUS_ENTRIES.length})` },
  { id: "implemented", label: "Implemented" },
  { id: "mock", label: "Mock-Tested" },
  { id: "unverified", label: "Real-Model Unverified" },
  { id: "absent", label: "Not Implemented" },
  { id: "scope", label: "Out of Scope" },
];

export function StatusPage() {
  const [filterIndex, setFilterIndex] = useState(0);
  return <XmbScreen document={<><p>The gateway is experimental. Automated contract tests use deterministic mock upstreams; real inference models remain unqualified. This ledger separates implemented behavior, test evidence and operational limits.</p><p className="xmb-document-meta">Reviewed {PROJECT_REVIEW.date} · main @ {PROJECT_REVIEW.revision.slice(0, 7)} · {PROJECT_REVIEW.ctestSuites} registered CTest suites</p><label className="xmb-field">Qualification filter<select value={filterIndex} onChange={event => setFilterIndex(Number(event.target.value))}>{FILTERS.map((filter,index) => <option key={filter.id} value={index}>{filter.label}</option>)}</select></label></>} subtitle="Experimental · mock-qualified protocol integrations · real-model compatibility unverified."
    sections={[FILTERS[filterIndex]].map((filter) => ({
      id: filter.id, label: filter.label,
      entries: STATUS_ENTRIES.filter((row) => filter.id === "all" || row.status === filter.id).map((row) => ({
        key: row.id, title: row.component, sub: row.subsystem, value: row.statusText, description: row.summary,
        panel: <><XmbSectionLabel>Verified behavior</XmbSectionLabel><p>{row.summary}</p>
          <XmbSectionLabel>Caveats & unverified boundaries</XmbSectionLabel><p>{row.caveats}</p>
          <p>Evidence: {row.evidence}</p><XmbRow href={row.evidenceHref}>Inspect in repository</XmbRow></>,
      })),
    }))} />;
}
