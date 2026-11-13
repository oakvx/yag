import { useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { Container, PageMasthead, StatusBadge } from "@/components/Primitives";
import { BLOB_URL, TREE_URL } from "@/data/repository";
import { RouteLink } from "@/router/RouterContext";
import { cn } from "@/utils/cn";

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

export function ArchitecturePage() {
  const [selectedId, setSelectedId] = useState<NodeId>("listener");
  const activeNode = ARCH_NODES.find((n) => n.id === selectedId) ?? ARCH_NODES[0];

  return (
    <div>
      <PageMasthead
        path="/architecture"
        eyebrow="Chapter 02 · Interactive System Blueprint"
        title={
          <>
            One binary, six internal stages, <em>zero hidden runtimes.</em>
          </>
        }
        lede="Select any node in the engineering schematic below to inspect its responsibilities, memory/socket bounds, and exact C17 implementation file."
        meta={[
          { k: "Binary", v: "yag · C17 + POSIX sockets", tone: "amber" },
          { k: "Libraries", v: "libcurl · pthreads · yyjson 0.12.0" },
          { k: "Execution", v: "Never runs models or tools", tone: "moss" },
        ]}
      />

      <section className="py-6 @lg:py-8">
        <Container>
          {/* Interactive Blueprint Frame */}
          <div className="border border-line-strong bg-panel">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.15em]">
              <span className="text-amber">Schematic 02.A · Navigable Host Topology</span>
              <span className="text-faint">Click any subsystem block [C1..U2] to inspect</span>
            </div>

            {/* SVG Blueprint */}
            <div className="overflow-x-auto bg-[rgba(3,12,34,0.55)] p-4 @lg:p-6">
              <svg
                viewBox="0 0 920 310"
                className="min-w-[740px] w-full h-auto"
                role="img"
                aria-label="Interactive YAG system architecture diagram with ten selectable subsystem blocks"
              >
                {/* Host Enclosure Box */}
                <rect
                  x="228"
                  y="20"
                  width="456"
                  height="274"
                  fill="rgba(108,203,255,0.025)"
                  stroke="rgba(108,203,255,0.4)"
                  strokeDasharray="5 4"
                />
                <g fontFamily="JetBrains Mono, monospace" fontSize="8.5" letterSpacing="1.3">
                  <text x="20" y="34" fill="#7F98BC">01 · CLIENT SURFACE</text>
                  <text x="242" y="36" fill="#6CCBFF">02 · YAG C17 HOST PROCESS (:8080)</text>
                  <text x="716" y="34" fill="#7F98BC">03 · UPSTREAM SERVERS</text>
                </g>

                {/* Signal Edges */}
                {EDGES.map((edge) => {
                  const isHighlighted = activeNode.connectedEdges.includes(edge.id);
                  return (
                    <g key={edge.id}>
                      <path
                        d={edge.d}
                        fill="none"
                        stroke={isHighlighted ? "rgba(108,203,255,0.55)" : "rgba(190,220,255,0.16)"}
                        strokeWidth={isHighlighted ? 1.8 : 1.1}
                      />
                      {isHighlighted && (
                        <path
                          d={edge.d}
                          fill="none"
                          stroke="#6CCBFF"
                          strokeWidth="2.4"
                          className="signal-flow"
                        />
                      )}
                    </g>
                  );
                })}

                {/* Selectable Nodes */}
                {ARCH_NODES.map((node) => {
                  const selected = node.id === selectedId;
                  return (
                    <g
                      key={node.id}
                      onClick={() => setSelectedId(node.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedId(node.id);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-pressed={selected}
                      aria-label={`${node.code} ${node.title}`}
                      className="cursor-pointer focus:outline-none"
                    >
                      <rect
                        x={node.x}
                        y={node.y}
                        width={node.w}
                        height={node.h}
                        fill={selected ? "rgba(60,140,230,0.3)" : "rgba(10,30,74,0.7)"}
                        stroke={selected ? "#6CCBFF" : "rgba(190,220,255,0.24)"}
                        strokeWidth={selected ? 1.6 : 1}
                      />
                      <rect
                        x={node.x}
                        y={node.y}
                        width={28}
                        height={18}
                        fill={selected ? "#6CCBFF" : "rgba(190,220,255,0.08)"}
                      />
                      <text
                        x={node.x + 14}
                        y={node.y + 12}
                        textAnchor="middle"
                        fontFamily="JetBrains Mono, monospace"
                        fontSize="8.5"
                        fontWeight="600"
                        fill={selected ? "#04122E" : "#A9C1E0"}
                      >
                        {node.code}
                      </text>
                      <text
                        x={node.x + 35}
                        y={node.y + 13}
                        fontFamily="JetBrains Mono, monospace"
                        fontSize="8"
                        fill="#7F98BC"
                      >
                        {node.sourceFile.split("/").pop()}
                      </text>
                      <text
                        x={node.x + 10}
                        y={node.y + 36}
                        fontFamily="Inter, sans-serif"
                        fontSize="11.5"
                        fontWeight="500"
                        fill="#EAF4FF"
                      >
                        {node.title}
                      </text>
                      <text
                        x={node.x + 10}
                        y={node.y + 52}
                        fontFamily="JetBrains Mono, monospace"
                        fontSize="8.5"
                        fill={selected ? "#6CCBFF" : "#7F98BC"}
                      >
                        {selected ? "● inspecting node" : "click to inspect"}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Quick Node Selector Strip for Mobile / Keyboard */}
            <div className="flex flex-wrap gap-1.5 border-t border-line bg-panel px-4 py-3">
              {ARCH_NODES.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSelectedId(n.id)}
                  className={cn(
                    "border px-2.5 py-1 font-mono text-[10px] transition-colors cursor-pointer",
                    n.id === selectedId
                      ? "border-amber bg-amber/15 text-paper"
                      : "border-line text-faint hover:text-paper",
                  )}
                >
                  <span className="text-amber">{n.code}</span> · {n.title}
                </button>
              ))}
            </div>

            {/* Synchronized Component Inspector */}
            <div className="grid border-t border-line-strong @3xl:grid-cols-12" aria-live="polite">
              <div className="border-b border-line p-5 @lg:p-6 @3xl:col-span-6 @3xl:border-b-0 @3xl:border-r">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="label text-amber">
                    Node {activeNode.code} · {activeNode.layer}
                  </span>
                  <a
                    href={activeNode.sourceHref}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-mono text-[11px] text-muted transition-colors hover:text-amber"
                  >
                    {activeNode.sourceFile} ↗
                  </a>
                </div>
                <h2 className="display mt-2.5 text-2xl text-paper @lg:text-3xl">{activeNode.title}</h2>
                <p className="mt-3 text-[14.5px] leading-[1.74] text-muted">{activeNode.summary}</p>

                <div className="mt-5 border-t border-line pt-4">
                  <p className="label text-faint">Implementation Invariants</p>
                  <ul className="mt-2.5 space-y-2">
                    {activeNode.invariants.map((inv) => (
                      <li key={inv} className="flex items-baseline gap-2.5 text-[13px] leading-relaxed text-paper/90">
                        <span aria-hidden="true" className="font-mono text-amber">▪</span>
                        <span>{inv}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-6 flex flex-wrap gap-2.5">
                  {activeNode.sourceAtlasId && (
                    <RouteLink to={`/source?file=${activeNode.sourceAtlasId}`} className="btn btn-amber">
                      Open in Source Explorer →
                    </RouteLink>
                  )}
                  <RouteLink to="/lifecycle" className="btn btn-outline">
                    Trace Request Lifecycle →
                  </RouteLink>
                </div>
              </div>

              <div className="bg-[rgba(3,12,34,0.62)] p-5 @lg:p-6 @3xl:col-span-6">
                <p className="label mb-3 text-faint">Corresponding Source / Wire Excerpt</p>
                <CodeBlock
                  code={activeNode.snippet}
                  lang={activeNode.id === "clients" || activeNode.id.includes("upstream") ? "bash" : "c"}
                  path={activeNode.sourceFile}
                  href={activeNode.sourceHref}
                  showLineNumbers={false}
                />
                <p className="mt-4 font-mono text-[11px] leading-relaxed text-faint">
                  State model: configuration is immutable after <code className="text-paper">config_load()</code> except
                  in-memory provider/client counters guarded by <code className="text-paper">pthread_mutex_t lock</code>.
                </p>
              </div>
            </div>
          </div>

          {/* Architectural Non-Goals Bar */}
          <div className="mt-10 grid gap-6 border-t border-line pt-8 @2xl:grid-cols-3">
            <div>
              <StatusBadge tone="scope">Permanent Non-Goal</StatusBadge>
              <h3 className="mt-3 font-serif text-xl text-paper">Zero model or tool execution</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
                YAG never loads weights, runs tokenizers, or executes client function tools. Tool definitions and tool
                call structures are relayed or translated; execution stays strictly on the client.
              </p>
            </div>
            <div>
              <StatusBadge tone="implemented">Memory Ownership</StatusBadge>
              <h3 className="mt-3 font-serif text-xl text-paper">Request-scoped buffers</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
                Each worker allocates its request buffer only after header authentication succeeds and frees it when the
                connection closes. No prompt or completion payload outlives the socket.
              </p>
            </div>
            <div>
              <StatusBadge tone="absent">Network Boundary</StatusBadge>
              <h3 className="mt-3 font-serif text-xl text-paper">POSIX foundation, not a fortress</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
                The listener uses one HTTP/1.x request per connection without native TLS, keep-alive, or chunked request
                bodies. Remote exposure requires a trusted TLS reverse proxy and firewall.
              </p>
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}
