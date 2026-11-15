import { useState } from "react";
import { XmbScreen, XmbSectionLabel } from "@/components/XmbScreen";
import { XmbRow } from "@/components/XmbRow";

const CLIENT_LABELS = [
  { name: "IDE Assistant", dialect: "Chat Completions" },
  { name: "Coding CLI", dialect: "Responses subset" },
  { name: "Agent Script", dialect: "Anthropic Messages" },
  { name: "Local Web UI", dialect: "Browser fetch" },
  { name: "Batch Worker", dialect: "Embeddings / Chat" },
];

const BACKEND_LABELS = [
  { name: "Ollama Host", url: ":11434/v1", secret: "$OLLAMA_KEY" },
  { name: "vLLM Coder", url: ":9000/v1", secret: "$VLLM_KEY" },
  { name: "llama.cpp Server", url: ":8081/v1", secret: "$LLAMA_KEY" },
  { name: "Remote /v1 Endpoint", url: "https://.../v1", secret: "$REMOTE_KEY" },
];

const FRICTION = [
                {
                  idx: "01",
                  title: "Ambient secret sprawl",
                  before: "Browser playgrounds, shell scripts, and IDE extensions each hold raw upstream bearer tokens.",
                  after: "Clients hold a YAG gateway key (optionally scoped to inference, models, or monitor). Upstream secrets stay in the host process environment.",
                },
                {
                  idx: "02",
                  title: "Endpoint drift across machines",
                  before: "Moving a model from :11434 to a dedicated :9000 server breaks every client pointing at the old port.",
                  after: "Clients keep calling :8080/v1. YAG_MODEL_ROUTES dispatches exact model IDs to their backend URLs behind the scenes.",
                },
                {
                  idx: "03",
                  title: "Incompatible client wire formats",
                  before: "An OpenAI-compatible server speaks /v1/chat/completions, while newer clients speak /v1/responses or Anthropic /v1/messages.",
                  after: "YAG translates bounded stateless Responses and Anthropic Messages subsets into Chat Completions, rejecting unsupported fields explicitly.",
                },
                {
                  idx: "04",
                  title: "Unbounded local listeners",
                  before: "Raw inference servers exposed directly to multiple tools often lack per-key rate windows or strict framing caps.",
                  after: "YAG enforces 16 KiB header caps, 1 MiB body caps, 32 concurrent connections, monotonic deadlines, and fixed-window 429 Retry-After limits.",
                },
];
export function ProblemPage() {
  const [centralized, setCentralized] = useState(false);
  const [clientCount, setClientCount] = useState(4);
  const [backendCount, setBackendCount] = useState(3);

  const clients = CLIENT_LABELS.slice(0, clientCount);
  const backends = BACKEND_LABELS.slice(0, backendCount);

  const directEdges = clientCount * backendCount;
  const gatewayEdges = clientCount + backendCount;

  const clientY = (i: number) => {
    const span = 260;
    const step = clientCount === 1 ? 0 : span / (clientCount - 1);
    return 55 + i * step;
  };

  const backendY = (j: number) => {
    const span = 240;
    const step = backendCount === 1 ? 0 : span / (backendCount - 1);
    return 65 + j * step;
  };

  const diagram = <><XmbSectionLabel>{centralized ? "Centralized boundary" : "Direct connections"}</XmbSectionLabel>
            <svg
              viewBox="0 0 860 370"
              className="xmb-diagram"
              role="img"
              aria-label={
                centralized
                  ? "Centralized topology where clients connect to YAG on :8080 and upstream credentials stay on the host"
                  : "Fragmented topology where every client directly connects to every upstream server and stores copies of upstream secrets"
              }
            >
              {/* Host Trust Boundary Line */}
              <line
                x1="430"
                y1="18"
                x2="430"
                y2="352"
                stroke={centralized ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.28)"}
                strokeWidth="1.2"
                strokeDasharray="4 4"
              />
              <text
                x="430"
                y="13"
                textAnchor="middle"
                fontFamily="JetBrains Mono, monospace"
                fontSize="9"
                fill={centralized ? "#ffffff" : "#ffffff"}
                letterSpacing="1.4"
              >
                {centralized
                  ? "HOST CREDENTIAL BOUNDARY (UPSTREAM KEYS NEVER CROSS LEFT)"
                  : "NO CENTRAL BOUNDARY — UPSTREAM KEYS COPIED INTO CLIENTS"}
              </text>

              {/* Connection Vectors */}
              {!centralized
                ? clients.map((_, ci) =>
                    backends.map((__, bi) => {
                      const y1 = clientY(ci);
                      const y2 = backendY(bi);
                      return (
                        <path
                          key={`mesh-${ci}-${bi}`}
                          d={`M 218 ${y1} C 360 ${y1}, 500 ${y2}, 636 ${y2}`}
                          fill="none"
                          stroke="rgba(255,255,255,0.34)"
                          strokeWidth="1.15"
                        />
                      );
                    }),
                  )
                : (
                  <>
                    {clients.map((_, ci) => {
                      const y1 = clientY(ci);
                      const d = `M 218 ${y1} C 292 ${y1}, 305 185, 362 185`;
                      return (
                        <g key={`in-${ci}`}>
                          <path d={d} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.4" />
                          <path d={d} fill="none" stroke="#ffffff" strokeWidth="2" className="signal-flow" />
                        </g>
                      );
                    })}
                    {backends.map((_, bi) => {
                      const y2 = backendY(bi);
                      const d = `M 498 185 C 555 185, 568 ${y2}, 636 ${y2}`;
                      return (
                        <g key={`out-${bi}`}>
                          <path d={d} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.4" />
                          <path d={d} fill="none" stroke="#ffffff" strokeWidth="2" className="signal-flow-slow" />
                        </g>
                      );
                    })}
                  </>
                )}

              {/* Central Gateway Node (materializes in centralized state) */}
              <g
                style={{
                  opacity: centralized ? 1 : 0.14,
                  transition: "opacity 380ms ease",
                }}
              >
                <rect
                  x="362"
                  y="115"
                  width="136"
                  height="140"
                  fill="none"
                  stroke={centralized ? "#ffffff" : "rgba(255,255,255,0.2)"}
                  strokeWidth="1.5"
                />
                <text x="430" y="142" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="11" fill="#ffffff" fontWeight="400">
                  YAG GATEWAY
                </text>
                <text x="430" y="158" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="9" fill="#ffffff">
                  127.0.0.1:8080
                </text>
                <line x1="376" y1="170" x2="484" y2="170" stroke="rgba(255,255,255,0.12)" />
                <text x="430" y="188" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="8.5" fill="#ffffff">
                  Auth · Scopes · Limits
                </text>
                <text x="430" y="204" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="8.5" fill="#ffffff">
                  Protocol Adaptation
                </text>
                <text x="430" y="220" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="8.5" fill="#ffffff">
                  Exact-Model Routing
                </text>
                <text x="430" y="241" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="8" fill="#ffffff">
                  host-side key_env
                </text>
              </g>

              {/* Client Nodes */}
              {clients.map((c, ci) => {
                const y = clientY(ci);
                return (
                  <g key={c.name}>
                    <rect
                      x="22"
                      y={y - 24}
                      width="196"
                      height="48"
                      fill="none"
                      stroke={centralized ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.5)"}
                    />
                    <text x="34" y={y - 5} fontFamily="Inter, sans-serif" fontSize="11.5" fill="#ffffff" fontWeight="400">
                      {c.name}
                    </text>
                    <text
                      x="34"
                      y={y + 12}
                      fontFamily="JetBrains Mono, monospace"
                      fontSize="8.5"
                      fill={centralized ? "#ffffff" : "#ffffff"}
                    >
                      {centralized ? "→ :8080 · YAG_API_KEY" : `holds ${backendCount} URLs + upstream keys`}
                    </text>
                  </g>
                );
              })}

              {/* Upstream Backend Nodes */}
              {backends.map((b, bi) => {
                const y = backendY(bi);
                return (
                  <g key={b.name}>
                    <rect
                      x="636"
                      y={y - 25}
                      width="202"
                      height="50"
                      fill="none"
                      stroke={centralized ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.25)"}
                    />
                    <text x="648" y={y - 6} fontFamily="Inter, sans-serif" fontSize="11.5" fill="#ffffff" fontWeight="400">
                      {b.name}
                    </text>
                    <text x="648" y={y + 9} fontFamily="JetBrains Mono, monospace" fontSize="8.5" fill="#ffffff">
                      {b.url}
                    </text>
                    <text x="648" y={y + 20} fontFamily="JetBrains Mono, monospace" fontSize="8" fill="#ffffff">
                      secret: {b.secret} {centralized ? "(host env only)" : "(distributed)"}
                    </text>
                  </g>
                );
              })}
            </svg>
    <dl className="xmb-facts">
      <div><dt>Configuration edges</dt><dd>{centralized ? gatewayEdges : directEdges}</dd></div>
      <div><dt>Client upstream secrets</dt><dd>{centralized ? "0 · gateway key only" : `${backendCount} secrets × ${clientCount} apps`}</dd></div>
      <div><dt>Adding a backend</dt><dd>{centralized ? "1 environment entry + restart" : `Reconfigure ${clientCount} clients`}</dd></div>
      <div><dt>Protocol mismatch</dt><dd>{centralized ? "Bounded gateway adaptation" : "Per-client shims"}</dd></div>
    </dl>
  </>;
  return <XmbScreen document={<p>Running a model is one command. Connecting every client to it is infrastructure. As clients and backends multiply, endpoints, credentials and API dialects spread across tools. This comparison shows what changes when YAG holds that boundary in one place.</p>} subtitle="Compare direct client connections with a single host credential boundary." sections={[
    { id: "topology", label: "Topology", panel: diagram, entries: [
      { key: "direct", title: "Before YAG", value: centralized ? "Direct N × M" : "Selected", activate: () => setCentralized(false), description: "Every client holds upstream URLs and copies of upstream secrets." },
      { key: "gateway", title: "With YAG", value: centralized ? "Selected" : "Centralized", activate: () => setCentralized(true), description: "One client endpoint; upstream secrets stay on the host." },
      { key: "clients", title: "Clients", value: String(clientCount), description: "Select to cycle through two to five clients.", activate: () => setClientCount((n) => n === 5 ? 2 : n + 1) },
      { key: "backends", title: "Upstreams", value: String(backendCount), description: "Select to cycle through two to four upstreams.", activate: () => setBackendCount((n) => n === 4 ? 2 : n + 1) },
    ] },
    { id: "analysis", label: "Engineering tradeoffs", entries: FRICTION.map((item) => ({ key: item.idx, title: item.title, description: item.after, panel: <>
      <XmbSectionLabel>Without a gateway</XmbSectionLabel><p>{item.before}</p><XmbSectionLabel>With YAG</XmbSectionLabel><p>{item.after}</p>
      <p>A gateway adds a loopback or LAN hop. That cost is justified only when it reduces the operational surface area.</p>
      <XmbRow to="/architecture">Inspect the C17 architecture</XmbRow>
    </> })) },
  ]} />;
}
