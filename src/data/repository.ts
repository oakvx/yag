import { PROJECT_SNAPSHOT } from "./project-snapshot.generated";
export const REPO_URL = "https://github.com/oakvx/yag";
export const BLOB_URL = `${REPO_URL}/blob/${PROJECT_SNAPSHOT.revision}`;
export const TREE_URL = `${REPO_URL}/tree/main`;

export const REPO_LINKS = {
  repo: REPO_URL,
  author: "https://github.com/oakvx",
  readme: `${REPO_URL}#readme`,
  endpoints: `${REPO_URL}#endpoints`,
  build: `${REPO_URL}#build`,
  run: `${REPO_URL}#run`,
  config: `${REPO_URL}#configuration`,
  security: `${REPO_URL}#security-threat-model`,
  statusDoc: `${BLOB_URL}/docs/architecture/STATUS.md`,
  dockerDoc: `${BLOB_URL}/docs/deployment/docker.md`,
  lanHubDoc: `${BLOB_URL}/docs/deployment/lan-hub.md`,
  releasesDoc: `${BLOB_URL}/docs/deployment/releases.md`,
  integrationsDoc: `${BLOB_URL}/docs/integrations/README.md`,
  codexDoc: `${BLOB_URL}/docs/integrations/codex.md`,
  claudeCodeDoc: `${BLOB_URL}/docs/integrations/claude-code.md`,
  ollamaDoc: `${BLOB_URL}/docs/integrations/ollama-colibri.md`,
  liveModelDoc: `${BLOB_URL}/docs/integrations/live-model.md`,
  realModelDoc: `${BLOB_URL}/docs/integrations/real-model.md`,
  license: `${BLOB_URL}/LICENSE`,
  issues: `${REPO_URL}/issues`,
  newIssue: `${REPO_URL}/issues/new`,
};

export type SourceCategory = "Entry & Structs" | "Listener & Auth" | "Routing & Transport" | "Protocol Adapters" | "Build & Tests" | "Control Plane";
export interface SourceExcerpt {
  id: string; shortTitle: string; path: string; href: string;
  lang: "c" | "python" | "cmake" | "bash" | "json";
  category: SourceCategory;
  kindLabel: "Host C17 Source" | "Header Definition" | "Build Definition" | "Mock Contract Test";
  summary: string; highlights: number[]; code: string; notes: string[]; caveat: string;
  relatedRoute: string; relatedLabel: string; startLine: number; endLine: number;
}
const SOURCE_METADATA: Array<Omit<SourceExcerpt, "href" | "code" | "highlights" | "startLine" | "endLine">> = [
  {
    "id": "main-c",
    "shortTitle": "Host Entrypoint",
    "path": "host/src/main.c",
    "lang": "c",
    "category": "Entry & Structs",
    "kindLabel": "Host C17 Source",
    "summary": "The complete host entrypoint loads configuration, installs SIGPIPE handling, initializes libcurl, runs the server and cleans up after it returns.",
    "notes": [
      "Configuration is loaded once at startup into stack-allocated yag_config; invalid env settings fail closed before any socket binds.",
      "SIGPIPE is ignored globally (paired with MSG_NOSIGNAL in send_all) so broken client streams never terminate the gateway.",
      "server_run() drains active worker threads on SIGINT/SIGTERM before curl_global_cleanup() runs."
    ],
    "caveat": "Complete file, including original includes and whitespace.",
    "relatedRoute": "/architecture",
    "relatedLabel": "Inspect in System Architecture"
  },
  {
    "id": "yag-h",
    "shortTitle": "Bounded State Structs",
    "path": "host/include/yag.h",
    "lang": "c",
    "category": "Entry & Structs",
    "kindLabel": "Header Definition",
    "summary": "A contiguous slice of yag_config shows the fixed-capacity key, route, replica and capability tables, plus transport limits and provider counters.",
    "notes": [
      "Every route owns its own yag_provider_stats struct (attempts, failures, latency_ms, consecutive_failures, open_until).",
      "No prompt history or request RingBuffer exists in yag_config — only unsigned long aggregate counters guarded by lock.",
      "Static ceilings (16 keys, 16 routes, 32 capabilities) eliminate unbounded dynamic table growth."
    ],
    "caveat": "Contiguous fields from yag_config. The remaining scheduler, managed-client and operator state is below this excerpt in the original header.",
    "relatedRoute": "/security",
    "relatedLabel": "View Trust Boundaries"
  },
  {
    "id": "server-auth",
    "shortTitle": "Pre-Body Header Auth",
    "path": "host/src/http/server.c",
    "lang": "c",
    "category": "Listener & Auth",
    "kindLabel": "Host C17 Source",
    "summary": "YAG authenticates headers BEFORE allocating or reading request bodies and BEFORE sending 100 Continue. An unauthenticated or under-scoped client cannot hold a worker open on a slow POST body.",
    "notes": [
      "Competing Authorization and X-API-Key headers on the same request are rejected with HTTP 400 to prevent ambiguous auth framing.",
      "X-API-Key is accepted only on /v1/messages routes; /v1/models and OpenAI routes require Authorization: Bearer.",
      "Rate-limit checks happen immediately after scope verification and return 429 with Retry-After seconds remaining."
    ],
    "caveat": "Excerpted from handle() in host/src/http/server.c.",
    "relatedRoute": "/lifecycle",
    "relatedLabel": "Trace Stage 02 · Auth"
  },
  {
    "id": "server-routes-redact",
    "shortTitle": "Redacted Route Inspection",
    "path": "host/src/http/server.c",
    "lang": "c",
    "category": "Listener & Auth",
    "kindLabel": "Host C17 Source",
    "summary": "When an authenticated client queries GET /api/routes, the host serializes only the configured model identifiers — upstream URLs and secret environment references never cross the socket.",
    "notes": [
      "Notice that c->routes[i].url and c->routes[i].key are intentionally omitted from the serialized JSON object.",
      "Clients only need to know which model IDs exist; backend topology stays opaque behind the gateway."
    ],
    "caveat": "Excerpted from handle() in host/src/http/server.c.",
    "relatedRoute": "/routing",
    "relatedLabel": "Test in Model Routing"
  },
  {
    "id": "config-routes",
    "shortTitle": "Exact-Model Route Lookup",
    "path": "host/src/core/config.c",
    "lang": "c",
    "category": "Routing & Transport",
    "kindLabel": "Host C17 Source",
    "summary": "Route selection is an exact strcmp() scan over c->routes. A match populates a temporary config struct with that route's URL and host-resolved secret; no match returns the default upstream config.",
    "notes": [
      "Zero regexes, prefix wildcards, or provider heuristics: strcmp(model, c->routes[i].model) == 0 is the entire rule.",
      "Route secrets (c->routes[i].key) were already resolved via getenv(key_env) during load_routes() at startup.",
      "Timeout is inherited uniformly from the host configuration."
    ],
    "caveat": "Verbatim function from host/src/core/config.c.",
    "relatedRoute": "/routing",
    "relatedLabel": "Open Interactive Router"
  },
  {
    "id": "openai-upstream",
    "shortTitle": "Upstream Dispatch & Fallback",
    "path": "host/src/inference/openai.c",
    "lang": "c",
    "category": "Routing & Transport",
    "kindLabel": "Host C17 Source",
    "summary": "Exact-model routes take priority. Otherwise the default pool admits a primary or eligible replica. Dedicated models cannot fall back to the generic primary; resource saturation is separate from transport failure.",
    "notes": [
      "Pool admission is tracked even for a single primary, preventing live configuration changes from racing active requests.",
      "Opt-in fallback only retries pre-response DNS/connect failures or route admission bypass. HTTP errors and ambiguous timeouts are never replayed.",
      "Pool admission slots are released after upstream completion. Exclusive replicas cannot fall back to the generic primary."
    ],
    "caveat": "Complete upstream_for_model() function. The lower-level 100 ms cancellation loop is in upstream_perform() in the same file.",
    "relatedRoute": "/lifecycle",
    "relatedLabel": "Trace Stage 05 · Forward"
  },
  {
    "id": "responses-adapter",
    "shortTitle": "Responses Stateless Adapter",
    "path": "host/src/protocols/openai_responses/request.c",
    "lang": "c",
    "category": "Protocol Adapters",
    "kindLabel": "Host C17 Source",
    "summary": "The Responses parser checks its top-level allowlist and validates model, input, instructions, stream, metadata and stateless store settings before translation.",
    "notes": [
      "instructions becomes a leading system message in the translated Chat Completions messages[] array.",
      "store: true or previous_response_id are rejected because YAG stores zero conversation state.",
      "Hosted tools such as web_search fail translate_tools() with 'Unsupported tool type: web_search'."
    ],
    "caveat": "Contiguous parser validation block. Tool translation and optional reasoning projections appear later in the same file.",
    "relatedRoute": "/protocols",
    "relatedLabel": "Inspect Protocol Wire Map"
  },
  {
    "id": "anthropic-adapter",
    "shortTitle": "Bounded Thinking Translation",
    "path": "host/src/protocols/anthropic/messages.c",
    "lang": "c",
    "category": "Protocol Adapters",
    "kindLabel": "Host C17 Source",
    "summary": "Thinking hints are validated and mapped to Chat reasoning_effort. Adaptive intent becomes medium and enabled intent becomes high; exact Anthropic thinking budgets are not reproduced.",
    "notes": [
      "Only type and budget_tokens are accepted in this object.",
      "A disabled hint cannot carry a budget; adaptive cannot carry one either.",
      "This mapping does not create native thinking blocks or guarantee model reasoning behavior."
    ],
    "caveat": "Complete thinking_valid() function. The rest of the Messages adapter implements the bounded text and function-tool subset.",
    "relatedRoute": "/protocols",
    "relatedLabel": "Compare in Protocol Landscape"
  },
  {
    "id": "cmake-build",
    "shortTitle": "CMake Native Target",
    "path": "CMakeLists.txt",
    "lang": "cmake",
    "category": "Build & Tests",
    "kindLabel": "Build Definition",
    "summary": "The native C17 target links libcurl, POSIX threads and vendored yyjson. This excerpt shows the actual source list and compiler settings.",
    "notes": [
      "The target includes scheduler, GPU probes, managed clients, provider management and admin audit modules.",
      "CTest registrations follow this target definition; registration is not proof of a successful test run."
    ],
    "caveat": "Opening build definition. The complete file contains all conditional CTest registrations.",
    "relatedRoute": "/deploy",
    "relatedLabel": "Open Build & Deploy Runbook"
  },
  {
    "id": "tests-contract",
    "shortTitle": "Mock Contract Verification",
    "path": "tests/anthropic.py",
    "lang": "python",
    "category": "Build & Tests",
    "kindLabel": "Mock Contract Test",
    "summary": "A deterministic mock test checks the exact order of Anthropic SSE events and the text reconstructed from content deltas.",
    "notes": [
      "The assertions cover event order and the completed text for a local mock upstream.",
      "Passing this test does not qualify a real inference model or every Claude Code tool workflow."
    ],
    "caveat": "One complete test method from tests/anthropic.py.",
    "relatedRoute": "/status",
    "relatedLabel": "Inspect Qualification Matrix"
  },
  {
    "id": "adaptive-scheduler",
    "shortTitle": "Adaptive GPU Admission",
    "path": "host/src/core/scheduler.c",
    "lang": "c",
    "category": "Control Plane",
    "kindLabel": "Host C17 Source",
    "summary": "When enabled, available GPU sensors adjust the admission ceiling using measured free VRAM, a safety margin and an operator-supplied per-request allowance.",
    "notes": [
      "Capacity never exceeds the configured maximum and keeps at least one slot.",
      "Missing or invalid VRAM sensors retain the static cap. Samples are limited to once per second.",
      "This is admission control, not a model-specific VRAM guarantee or a distributed GPU scheduler."
    ],
    "caveat": "Complete refresh_adaptive_capacity() function. Per-replica VRAM reservations are a separate operator-estimated mechanism.",
    "relatedRoute": "/architecture",
    "relatedLabel": "Read the host architecture"
  },
  {
    "id": "pool-admission",
    "shortTitle": "Replica Resource Admission",
    "path": "host/src/inference/openai.c",
    "lang": "c",
    "category": "Control Plane",
    "kindLabel": "Host C17 Source",
    "summary": "The pool filters replicas by model policy, cooldown and declared capacity before reserving the selected backend.",
    "notes": [
      "The pool supports up to eight replicas and exact declared model allowlists.",
      "Per-run request limits count reservations, not money or successful generations.",
      "Concurrency and VRAM reservations are held through the upstream request, including streaming."
    ],
    "caveat": "Complete pool_choose_locked() function. Declared resource budgets do not measure another server’s free GPU memory.",
    "relatedRoute": "/routing",
    "relatedLabel": "Read routing and pool boundaries"
  },
  {
    "id": "admin-audit",
    "shortTitle": "Private Admin Event Audit",
    "path": "host/src/core/admin_audit.c",
    "lang": "c",
    "category": "Control Plane",
    "kindLabel": "Host C17 Source",
    "summary": "An opt-in JSONL trail records fixed administrative route and method labels with HTTP status and time, without copying request bodies or identities.",
    "notes": [
      "The audit file must be enabled and validated during startup.",
      "Prompts, keys, IP addresses and client labels do not enter this event trail.",
      "An event records an attempted response, not proof that the remote peer received it."
    ],
    "caveat": "Complete file. This is not tamper-evident identity auditing or persistent inference history.",
    "relatedRoute": "/security",
    "relatedLabel": "Review the security boundaries"
  }
];
export const SOURCE_EXCERPTS: SourceExcerpt[] = SOURCE_METADATA.map(entry => ({
  ...entry, ...PROJECT_SNAPSHOT.excerpts[entry.id as keyof typeof PROJECT_SNAPSHOT.excerpts], highlights: [],
}));
export function getExcerptById(id: string): SourceExcerpt {
  return SOURCE_EXCERPTS.find(entry => entry.id === id) ?? SOURCE_EXCERPTS[0];
}
