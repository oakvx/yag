import { XmbScreen, XmbSectionLabel } from "@/components/XmbScreen";
import { XmbRow } from "@/components/XmbRow";
import { CodeBlock } from "@/components/CodeBlock";
import { BLOB_URL, TREE_URL } from "@/data/repository";

type NodeId =
  | "clients"
  | "console"
  | "listener"
  | "auth"
  | "limits"
  | "protocols"
  | "router"
  | "transport"
  | "default_upstream"
  | "routed_upstreams";

interface ArchNode {
  id: NodeId;
  code: string;
  title: string;
  layer: "Client Surface" | "YAG Native Host (:8080)" | "Upstream Backends";
  x: number;
  y: number;
  w: number;
  h: number;
  sourceFile: string;
  sourceHref: string;
  sourceAtlasId?: string;
  summary: string;
  invariants: string[];
  snippet: string;
  connectedEdges: string[];
}

const ARCH_NODES: ArchNode[] = [
  {
    id: "clients",
    code: "C1",
    title: "SDKs, curl & CLI Agents",
    layer: "Client Surface",
    x: 20,
    y: 58,
    w: 175,
    h: 74,
    sourceFile: "docs/integrations/README.md",
    sourceHref: `${BLOB_URL}/docs/integrations/README.md`,
    summary:
      "External HTTP clients connect to YAG using only the gateway secret (Bearer or X-API-Key on /v1/messages). Clients must keep their write side open while awaiting streamed responses because peer EOF cancels upstream work.",
    invariants: [
      "Holds YAG gateway key only — never upstream credentials",
      "Speaks OpenAI Chat, Responses subset, or Anthropic Messages subset",
      "Codex CLI & Claude Code passed pinned mock cycles only; real models unverified",
    ],
    snippet: `curl http://127.0.0.1:8080/v1/chat/completions \\
  -H "Authorization: Bearer $YAG_API_KEY" \\
  -H 'Content-Type: application/json' \\
  -d '{"model":"llama3.2","messages":[{"role":"user","content":"Hello"}]}'`,
    connectedEdges: ["e-clients-listener"],
  },
  {
    id: "console",
    code: "C2",
    title: "React Console (Optional)",
    layer: "Client Surface",
    x: 20,
    y: 168,
    w: 175,
    h: 74,
    sourceFile: "console/src/main.tsx",
    sourceHref: `${BLOB_URL}/console/src/main.tsx`,
    summary:
      "Static React + TypeScript bundle served directly by the C17 host from YAG_ASSETS (default console/dist) using symlink-safe openat(..., O_NOFOLLOW) and strict Content-Security-Policy headers.",
    invariants: [
      "Stores gateway key in browser sessionStorage for the current tab only",
      "Provides status, model discovery, copyable curl snippets, and cancellable text chat",
      "Does not execute tools or persist chat history on the server",
    ],
    snippet: `"Content-Security-Policy: default-src 'self'; "
"style-src 'self' 'unsafe-inline'; connect-src 'self'\\r\\n"`,
    connectedEdges: ["e-console-listener"],
  },
  {
    id: "listener",
    code: "H1",
    title: "POSIX HTTP/1.x Listener",
    layer: "YAG Native Host (:8080)",
    x: 245,
    y: 48,
    w: 195,
    h: 64,
    sourceFile: "host/src/http/server.c",
    sourceHref: `${BLOB_URL}/host/src/http/server.c`,
    sourceAtlasId: "server-auth",
    summary:
      "Binds 127.0.0.1:8080 by default and spawns one detached pthread worker per accepted socket up to MAX_CONNECTIONS (32). Enforces canonical request-line spacing, rejects chunked Transfer-Encoding, and drains active workers on SIGINT/SIGTERM.",
    invariants: [
      "MAX_CONNECTIONS = 32 (returns 503 when saturated)",
      "MAX_HEADER = 16384 bytes; control bytes & duplicate Host rejected",
      "One HTTP/1.x request per connection (Connection: close)",
    ],
    snippet: `if (c->active >= MAX_CONNECTIONS) {
  pthread_mutex_unlock(&c->lock);
  error(fd, 503, "Connection limit reached");
  close(fd); continue;
}`,
    connectedEdges: ["e-clients-listener", "e-console-listener", "e-listener-auth"],
  },
  {
    id: "auth",
    code: "H2",
    title: "Pre-Body Auth & Scopes",
    layer: "YAG Native Host (:8080)",
    x: 245,
    y: 132,
    w: 195,
    h: 64,
    sourceFile: "host/src/http/server.c",
    sourceHref: `${BLOB_URL}/host/src/http/server.c`,
    sourceAtlasId: "server-auth",
    summary:
      "Verifies credentials from headers BEFORE allocating or reading POST request bodies and before sending 100 Continue. Uses constant-time length-masked XOR comparison across the primary key and up to 16 scoped extra keys.",
    invariants: [
      "Primary key ≥ 16 chars (full scope = 15)",
      "≤ 16 extra keys with scopes: all, inference, models, monitor, inference+models",
      "Competing Authorization and X-API-Key headers rejected with HTTP 400",
    ],
    snippet: `/* Authenticate from headers BEFORE buffering potentially large request bodies. */
if (auth && native_key) { error(fd, 400, "Choose one authentication header"); goto done; }`,
    connectedEdges: ["e-listener-auth", "e-auth-limits"],
  },
  {
    id: "limits",
    code: "H3",
    title: "Deadlines, Rate & Scheduler",
    layer: "YAG Native Host (:8080)",
    x: 245,
    y: 216,
    w: 195,
    h: 64,
    sourceFile: "host/src/core/scheduler.c",
    sourceHref: `${BLOB_URL}/host/src/core/scheduler.c`,
    summary:
      "Applies monotonic deadlines to headers (10 s default) and bodies (30 s default), enforces YAG_MAX_BODY_BYTES (1 MiB default), checks fixed 60-second per-key rate windows, and optionally queues per-key concurrent inference.",
    invariants: [
      "HTTP 429 includes Retry-After seconds remaining in current 60 s window",
      "YAG_MAX_BODY_BYTES configurable 65536..8388608 (default 1048576)",
      "Optional fair per-credential admission via scheduler_acquire()",
    ],
    snippet: `if (!rate_permit(c, key_index, &retry_after)) {
  rate_limited(fd, retry_after);
  goto done;
}`,
    connectedEdges: ["e-auth-limits", "e-limits-protocols"],
  },
  {
    id: "protocols",
    code: "H4",
    title: "Protocol Dispatch & Adapters",
    layer: "YAG Native Host (:8080)",
    x: 472,
    y: 48,
    w: 195,
    h: 64,
    sourceFile: "host/src/protocols/",
    sourceHref: `${TREE_URL}/host/src/protocols`,
    sourceAtlasId: "responses-adapter",
    summary:
      "Chat Completions, completions, and embeddings pass bodies straight through after minimal top-level JSON validation. Responses (/v1/responses) and Anthropic Messages (/v1/messages) translate bounded subsets into Chat JSON.",
    invariants: [
      "Chat proxy checks only top-level model string and messages[] array",
      "Responses adapter is strictly stateless (store=false) and flattens namespaces",
      "Unsupported fields or hosted tools fail closed with explicit 400/501 errors",
    ],
    snippet: `if (!yyjson_is_obj(root) || !yyjson_is_str(yyjson_obj_get(root, "model")) ||
    !yyjson_is_arr(yyjson_obj_get(root, "messages")))
  error(fd, 400, "Expected JSON object with model string and messages array");`,
    connectedEdges: ["e-limits-protocols", "e-protocols-router"],
  },
  {
    id: "router",
    code: "H5",
    title: "Exact-Model Route Selector",
    layer: "YAG Native Host (:8080)",
    x: 472,
    y: 132,
    w: 195,
    h: 64,
    sourceFile: "host/src/core/config.c",
    sourceHref: `${BLOB_URL}/host/src/core/config.c`,
    sourceAtlasId: "config-routes",
    summary:
      "Scans up to 16 startup-validated YAG_MODEL_ROUTES entries using exact strcmp(). A match substitutes that route's upstream URL and host-resolved key_env secret; unmatched models fall through to YAG_UPSTREAM_URL.",
    invariants: [
      "GET /api/routes exposes configured model IDs only — never URLs or secrets",
      "GET /v1/models merges default upstream discovery with static route IDs",
      "No predictive capability routing or live route mutation without restart",
    ],
    snippet: `if (strcmp(model, c->routes[i].model)) continue;
selected->upstream = c->routes[i].url;
selected->upstream_key = c->routes[i].key;`,
    connectedEdges: ["e-protocols-router", "e-router-transport"],
  },
  {
    id: "transport",
    code: "H6",
    title: "libcurl Multi-Poll & Breaker",
    layer: "YAG Native Host (:8080)",
    x: 472,
    y: 216,
    w: 195,
    h: 64,
    sourceFile: "host/src/inference/openai.c",
    sourceHref: `${BLOB_URL}/host/src/inference/openai.c`,
    sourceAtlasId: "openai-upstream",
    summary:
      "Attaches upstream Bearer credentials server-side, disables redirects, polls client sockets every 100 ms to abort abandoned streams, tracks passive circuit-breaker stats, and captures usage up to 128 KiB without saving prompts.",
    invariants: [
      "10 s connect timeout · 120 s default total timeout · redirects disabled",
      "Opt-in circuit breaker (1..20 consecutive failures) with single half-open probe",
      "Opt-in fallback retries DNS/connect errors ONLY — never HTTP responses or timeouts",
    ],
    snippet: `mc = curl_multi_poll(multi, NULL, 0, 100, &activity);
if (cancel_fd >= 0 && peer_closed(cancel_fd)) {
  result = (int)CURLE_ABORTED_BY_CALLBACK; break;
}`,
    connectedEdges: ["e-router-transport", "e-transport-default", "e-transport-routed"],
  },
  {
    id: "default_upstream",
    code: "U1",
    title: "Default Upstream (/v1)",
    layer: "Upstream Backends",
    x: 716,
    y: 68,
    w: 184,
    h: 82,
    sourceFile: "host/src/inference/models.c",
    sourceHref: `${BLOB_URL}/host/src/inference/models.c`,
    summary:
      "Primary OpenAI-compatible inference server configured via YAG_UPSTREAM_URL (and optional YAG_UPSTREAM_KEY) plus up to 8 optional homogeneous replicas in YAG_UPSTREAM_POOL.",
    invariants: [
      "Authoritative source for dynamic model discovery on GET /v1/models",
      "Receives all unmatched model IDs",
      "Status codes and upstream error bodies are relayed verbatim to the client",
    ],
    snippet: `export YAG_UPSTREAM_URL="http://127.0.0.1:11434/v1"
# Optional secret stays on host:
export YAG_UPSTREAM_KEY="YOUR_UPSTREAM_SECRET"`,
    connectedEdges: ["e-transport-default"],
  },
  {
    id: "routed_upstreams",
    code: "U2",
    title: "Model-Specific Routes [0..15]",
    layer: "Upstream Backends",
    x: 716,
    y: 182,
    w: 184,
    h: 82,
    sourceFile: "host/src/core/config.c",
    sourceHref: `${BLOB_URL}/host/src/core/config.c`,
    sourceAtlasId: "config-routes",
    summary:
      "Up to 16 dedicated OpenAI-compatible servers mapped to exact model identifiers. Each route references its secret indirectly through key_env so credentials are never embedded inline in route JSON.",
    invariants: [
      "Static route presence does not guarantee backend reachability or tool support",
      "POST /api/provider/check performs a 3-second /models reachability probe",
      "Independent per-route attempt, failure, token, and circuit state counters",
    ],
    snippet: `export YAG_ROUTE_KEY='SECOND_BACKEND_SECRET'
export YAG_MODEL_ROUTES='[
  {"model":"my-other-model","url":"http://127.0.0.1:9000/v1","key_env":"YAG_ROUTE_KEY"}
]'`,
    connectedEdges: ["e-transport-routed"],
  },
];

const EDGES: Array<{ id: string; d: string }> = [
  { id: "e-clients-listener", d: "M 195 95 C 218 95, 222 80, 245 80" },
  { id: "e-console-listener", d: "M 195 205 C 222 205, 218 92, 245 92" },
  { id: "e-listener-auth", d: "M 342 112 L 342 132" },
  { id: "e-auth-limits", d: "M 342 196 L 342 216" },
  { id: "e-limits-protocols", d: "M 440 248 C 458 248, 454 80, 472 80" },
  { id: "e-protocols-router", d: "M 569 112 L 569 132" },
  { id: "e-router-transport", d: "M 569 196 L 569 216" },
  { id: "e-transport-default", d: "M 667 240 C 692 240, 688 109, 716 109" },
  { id: "e-transport-routed", d: "M 667 254 C 692 254, 692 223, 716 223" },
];

function NodeDetail({ activeNode }: { activeNode: (typeof ARCH_NODES)[number] }) {
  return <><XmbSectionLabel>{activeNode.layer}</XmbSectionLabel>
              <svg
                viewBox="0 0 920 310"
                className="xmb-diagram"
                role="img"
                aria-label="YAG system architecture diagram; the screen rows select each subsystem"
              >
                {/* Host Enclosure Box */}
                <rect
                  x="228"
                  y="20"
                  width="456"
                  height="274"
                  fill="none"
                  stroke="rgba(255,255,255,0.4)"
                  strokeDasharray="5 4"
                />
                <g fontFamily="JetBrains Mono, monospace" fontSize="8.5" letterSpacing="1.3">
                  <text x="20" y="34" fill="#ffffff">01 · CLIENT SURFACE</text>
                  <text x="242" y="36" fill="#ffffff">02 · YAG C17 HOST PROCESS (:8080)</text>
                  <text x="716" y="34" fill="#ffffff">03 · UPSTREAM SERVERS</text>
                </g>

                {/* Signal Edges */}
                {EDGES.map((edge) => {
                  const isHighlighted = activeNode.connectedEdges.includes(edge.id);
                  return (
                    <g key={edge.id}>
                      <path
                        d={edge.d}
                        fill="none"
                        stroke={isHighlighted ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.16)"}
                        strokeWidth={isHighlighted ? 1.8 : 1.1}
                      />
                      {isHighlighted && (
                        <path
                          d={edge.d}
                          fill="none"
                          stroke="#ffffff"
                          strokeWidth="2.4"
                          className="signal-flow"
                        />
                      )}
                    </g>
                  );
                })}

                {/* Selectable Nodes */}
                {ARCH_NODES.map((node) => {
                  const selected = node.id === activeNode.id;
                  return (
                    <g
                      key={node.id}
                    >
                      <rect
                        x={node.x}
                        y={node.y}
                        width={node.w}
                        height={node.h}
                        fill="none"
                        stroke={selected ? "#ffffff" : "rgba(255,255,255,0.24)"}
                        strokeWidth={selected ? 1.6 : 1}
                      />
                      <rect
                        x={node.x}
                        y={node.y}
                        width={28}
                        height={18}
                        fill="none"
                      />
                      <text
                        x={node.x + 14}
                        y={node.y + 12}
                        textAnchor="middle"
                        fontFamily="JetBrains Mono, monospace"
                        fontSize="8.5"
                        fontWeight="400"
                        fill="none"
                      >
                        {node.code}
                      </text>
                      <text
                        x={node.x + 35}
                        y={node.y + 13}
                        fontFamily="JetBrains Mono, monospace"
                        fontSize="8"
                        fill="#ffffff"
                      >
                        {node.sourceFile.split("/").pop()}
                      </text>
                      <text
                        x={node.x + 10}
                        y={node.y + 36}
                        fontFamily="Inter, sans-serif"
                        fontSize="11.5"
                        fontWeight="400"
                        fill="#ffffff"
                      >
                        {node.title}
                      </text>
                      <text
                        x={node.x + 10}
                        y={node.y + 52}
                        fontFamily="JetBrains Mono, monospace"
                        fontSize="8.5"
                        fill="none"
                      >
                        {selected ? "● inspecting node" : ""}
                      </text>
                    </g>
                  );
                })}
              </svg>
    <p>{activeNode.summary}</p>
    <XmbSectionLabel>Implementation invariants</XmbSectionLabel>
    <ul>{activeNode.invariants.map((item) => <li key={item}>{item}</li>)}</ul>
    <CodeBlock code={activeNode.snippet} lang={activeNode.id === "clients" || activeNode.id.includes("upstream") ? "bash" : "c"} path={activeNode.sourceFile} href={activeNode.sourceHref} showLineNumbers={false} />
    <p>Static routes and primary upstream settings are loaded at startup. Managed client keys and stored pool replicas can change through guarded local administration; shared runtime state is protected by the configuration mutex.</p>
    {activeNode.sourceAtlasId && <XmbRow to={`/source?file=${activeNode.sourceAtlasId}`} hint="Read this subsystem's source excerpt.">Open in Source Explorer</XmbRow>}
    <XmbRow to="/lifecycle" hint="Step through a request from admission to socket close.">Trace request lifecycle</XmbRow>
  </>;
}

export function ArchitecturePage() {
  return <XmbScreen document={<p>YAG is one C17 process with six internal stages. It authenticates request headers before allocating bodies, applies bounded admission, adapts supported protocols and dispatches to an upstream. Select a subsystem below to inspect its responsibilities and source.</p>} initialSelected={2} subtitle="One binary, six internal stages, zero hidden runtimes." sections={[
    { id: "subsystems", label: "Host topology", interactive: true, entries: ARCH_NODES.map((node) => ({ key: node.id, title: node.title, value: node.code, description: node.summary, panel: <NodeDetail activeNode={node} /> })) },
    { id: "boundaries", label: "Boundaries", entries: [
      { key: "execution", title: "Zero model or tool execution", value: "Permanent non-goal", description: "Tool definitions and calls are relayed or translated. Execution stays on the client." },
      { key: "memory", title: "Request-scoped buffers", value: "Memory ownership", description: "Workers allocate bodies after authentication and free them when connections close. No payload outlives its socket." },
      { key: "admission", title: "Adaptive admission and replica budgets", description: "The optional FIFO scheduler uses available Linux DRM/sysfs or NVIDIA NVML sensors to adjust its static ceiling. Missing sensors retain the static cap. Pool replicas separately use operator-estimated reservations; neither mechanism guarantees model-specific VRAM safety.", panel: <><p>The optional FIFO scheduler can adjust concurrency from available GPU sensors while respecting configured and per-key limits. Missing VRAM readings retain the static cap.</p><p>Pool replicas separately enforce declared concurrency, model allowlists and estimated VRAM reservations. These are distinct mechanisms, not automatic model sizing.</p><XmbRow to="/source?file=adaptive-scheduler">Read adaptive admission</XmbRow><XmbRow to="/source?file=pool-admission">Read pool admission</XmbRow></> },
      { key: "network", title: "POSIX foundation", value: "Network boundary", description: "One HTTP/1.x request per connection. No native TLS, keep-alive or chunked request bodies. Remote exposure requires a trusted TLS proxy and firewall." },
    ] },
  ]} />;
}
