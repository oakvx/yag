import { useState } from "react";
import { Container, PageMasthead, Reveal } from "@/components/Primitives";
import { RouteLink } from "@/router/RouterContext";
import { cn } from "@/utils/cn";

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

  return (
    <div>
      <PageMasthead
        path="/problem"
        eyebrow="Chapter 01 · Engineering Problem"
        title={
          <>
            Running a model is one command. <em>Wiring every client to it is infrastructure.</em>
          </>
        }
        lede="As soon as a self-hosted setup grows beyond one client talking to one localhost server, endpoints, upstream secrets, and API dialects multiply across tools. Toggle the topology below to observe what changes when a gateway is placed at the boundary."
        meta={[
          { k: "Without YAG", v: `${directEdges} direct client→upstream pairings`, tone: "rust" },
          { k: "With YAG", v: "1 client endpoint · host-retained secrets", tone: "amber" },
          { k: "Scope", v: "Routing & translation only (no inference)" },
        ]}
      />

      {/* INTERACTIVE TOPOLOGY TRANSFORMATION STAGE */}
      <section className="border-b border-line py-6 @lg:py-8">
        <Container>
          {/* Control Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 border border-line-strong bg-panel p-4">
            <div role="group" aria-label="Select architecture topology" className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={!centralized}
                onClick={() => setCentralized(false)}
                className={cn(
                  "px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] border transition-colors cursor-pointer",
                  !centralized
                    ? "border-rust bg-rust/15 text-paper"
                    : "border-line text-faint hover:text-paper",
                )}
              >
                01 · Before YAG (Fragmented N×M)
              </button>
              <button
                type="button"
                aria-pressed={centralized}
                onClick={() => setCentralized(true)}
                className={cn(
                  "px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] border transition-colors cursor-pointer",
                  centralized
                    ? "border-amber bg-amber/15 text-paper"
                    : "border-line text-faint hover:text-paper",
                )}
              >
                02 · With YAG (Centralized Boundary)
              </button>
            </div>

            {/* Scale controls */}
            <div className="flex flex-wrap items-center gap-6 font-mono text-[11px]">
              <label className="flex items-center gap-2.5 text-muted">
                <span>CLIENTS: {clientCount}</span>
                <input
                  type="range"
                  min={2}
                  max={5}
                  value={clientCount}
                  onChange={(e) => setClientCount(Number(e.target.value))}
                  className="accent-[#6ccbff] cursor-pointer"
                />
              </label>
              <label className="flex items-center gap-2.5 text-muted">
                <span>UPSTREAMS: {backendCount}</span>
                <input
                  type="range"
                  min={2}
                  max={4}
                  value={backendCount}
                  onChange={(e) => setBackendCount(Number(e.target.value))}
                  className="accent-[#6ccbff] cursor-pointer"
                />
              </label>
            </div>
          </div>

          {/* Animated SVG Topology Canvas */}
          <div className="border-x border-b border-line-strong bg-[rgba(3,12,34,0.55)] p-4 @lg:p-6">
            <svg
              viewBox="0 0 860 370"
              className="w-full h-auto"
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
                stroke={centralized ? "rgba(108,203,255,0.55)" : "rgba(255,142,122,0.28)"}
                strokeWidth="1.2"
                strokeDasharray="4 4"
              />
              <text
                x="430"
                y="13"
                textAnchor="middle"
                fontFamily="JetBrains Mono, monospace"
                fontSize="9"
                fill={centralized ? "#6CCBFF" : "#FF8E7A"}
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
                          stroke="rgba(255,142,122,0.34)"
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
                          <path d={d} fill="none" stroke="rgba(108,203,255,0.45)" strokeWidth="1.4" />
                          <path d={d} fill="none" stroke="#6CCBFF" strokeWidth="2" className="signal-flow" />
                        </g>
                      );
                    })}
                    {backends.map((_, bi) => {
                      const y2 = backendY(bi);
                      const d = `M 498 185 C 555 185, 568 ${y2}, 636 ${y2}`;
                      return (
                        <g key={`out-${bi}`}>
                          <path d={d} fill="none" stroke="rgba(126,227,196,0.5)" strokeWidth="1.4" />
                          <path d={d} fill="none" stroke="#7EE3C4" strokeWidth="2" className="signal-flow-slow" />
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
                  fill="rgba(14,40,96,0.78)"
                  stroke={centralized ? "#6CCBFF" : "rgba(190,220,255,0.2)"}
                  strokeWidth="1.5"
                />
                <text x="430" y="142" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="11" fill="#EAF4FF" fontWeight="600">
                  YAG GATEWAY
                </text>
                <text x="430" y="158" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="9" fill="#6CCBFF">
                  127.0.0.1:8080
                </text>
                <line x1="376" y1="170" x2="484" y2="170" stroke="rgba(190,220,255,0.12)" />
                <text x="430" y="188" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="8.5" fill="#A9C1E0">
                  Auth · Scopes · Limits
                </text>
                <text x="430" y="204" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="8.5" fill="#A9C1E0">
                  Protocol Adaptation
                </text>
                <text x="430" y="220" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="8.5" fill="#A9C1E0">
                  Exact-Model Routing
                </text>
                <text x="430" y="241" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontSize="8" fill="#7EE3C4">
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
                      fill="rgba(10,30,74,0.7)"
                      stroke={centralized ? "rgba(190,220,255,0.25)" : "rgba(255,142,122,0.5)"}
                    />
                    <text x="34" y={y - 5} fontFamily="Inter, sans-serif" fontSize="11.5" fill="#EAF4FF" fontWeight="500">
                      {c.name}
                    </text>
                    <text
                      x="34"
                      y={y + 12}
                      fontFamily="JetBrains Mono, monospace"
                      fontSize="8.5"
                      fill={centralized ? "#6CCBFF" : "#FF8E7A"}
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
                      fill="rgba(10,30,74,0.7)"
                      stroke={centralized ? "rgba(126,227,196,0.5)" : "rgba(190,220,255,0.25)"}
                    />
                    <text x="648" y={y - 6} fontFamily="Inter, sans-serif" fontSize="11.5" fill="#EAF4FF" fontWeight="500">
                      {b.name}
                    </text>
                    <text x="648" y={y + 9} fontFamily="JetBrains Mono, monospace" fontSize="8.5" fill="#A9C1E0">
                      {b.url}
                    </text>
                    <text x="648" y={y + 20} fontFamily="JetBrains Mono, monospace" fontSize="8" fill="#7F98BC">
                      secret: {b.secret} {centralized ? "(host env only)" : "(distributed)"}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Structural Metrics Comparison Strip */}
            <div className="mt-4 grid gap-px bg-line @lg:grid-cols-4">
              {[
                {
                  k: "Configuration Edges",
                  v: centralized ? `${gatewayEdges} (${clientCount} in + ${backendCount} host)` : `${directEdges} (${clientCount}×${backendCount} mesh)`,
                  accent: centralized ? "text-amber" : "text-rust",
                },
                {
                  k: "Client-Side Upstream Keys",
                  v: centralized ? "0 (gateway key only)" : `${backendCount} secrets × ${clientCount} apps`,
                  accent: centralized ? "text-moss" : "text-rust",
                },
                {
                  k: "Adding a Backend",
                  v: centralized ? "1 env entry + host restart" : `Reconfigure ${clientCount} clients`,
                  accent: "text-paper",
                },
                {
                  k: "Protocol Mismatch",
                  v: centralized ? "Adapted at gateway (bounded)" : "Per-client shims or incompatible",
                  accent: "text-paper",
                },
              ].map((cell) => (
                <div key={cell.k} className="bg-panel p-3.5">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{cell.k}</div>
                  <div className={cn("mt-1.5 font-mono text-[12.5px] font-medium", cell.accent)}>{cell.v}</div>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </section>

      {/* ARCHITECTURAL ANALYSIS: FOUR CONCRETE FRICTION POINTS */}
      <section className="py-6 @lg:py-8">
        <Container>
          <div className="grid gap-10 @3xl:grid-cols-12">
            <Reveal className="@3xl:col-span-4">
              <p className="label text-amber">Structural Breakdown</p>
              <h2 className="display mt-3 text-3xl text-paper">
                Four problems solved by one extra local hop.
              </h2>
              <p className="mt-4 text-[14px] leading-relaxed text-muted">
                Every gateway introduces an extra network hop on loopback or LAN. That hop is only justified if it
                strictly reduces operational surface area without inventing new runtime magic.
              </p>
              <div className="mt-6">
                <RouteLink to="/architecture" className="btn btn-primary">
                  Inspect the C17 Architecture →
                </RouteLink>
              </div>
            </Reveal>

            <div className="grid gap-6 @lg:grid-cols-2 @3xl:col-span-8">
              {[
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
              ].map((item, i) => (
                <Reveal key={item.idx} delay={i * 50} className="border-t border-line-strong pt-4">
                  <div className="flex items-baseline justify-between font-mono text-[10.5px]">
                    <span className="text-amber">{item.idx}</span>
                    <span className="uppercase tracking-[0.14em] text-faint">Before → With YAG</span>
                  </div>
                  <h3 className="mt-2 font-serif text-2xl text-paper">{item.title}</h3>
                  <p className="mt-3 border-l border-rust/50 pl-3 text-[13px] leading-relaxed text-faint">
                    <strong className="font-mono text-[10px] uppercase text-rust">Without: </strong>
                    {item.before}
                  </p>
                  <p className="mt-2.5 border-l border-amber/60 pl-3 text-[13.5px] leading-relaxed text-muted">
                    <strong className="font-mono text-[10px] uppercase text-amber">With YAG: </strong>
                    {item.after}
                  </p>
                </Reveal>
              ))}
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}
