import { XmbScreen, XmbSectionLabel, type XmbScreenSection } from "@/components/XmbScreen";
import { REPO_LINKS } from "@/data/repository";
import { PROJECT_REVIEW } from "@/data/projectKnowledge";
import type { GlyphName } from "@/xmb/categories";

type CaseId = "chat" | "responses" | "messages" | "routed";

const CASES: Array<{
  id: CaseId;
  client: string;
  endpoint: string;
  mode: string;
  dest: 0 | 1;
  note: string;
}> = [
  {
    id: "chat",
    client: "OpenAI SDK / curl",
    endpoint: "POST /v1/chat/completions",
    mode: "Transparent passthrough (SSE + tool_calls)",
    dest: 0,
    note: "Body and upstream HTTP status are forwarded; the upstream credential is attached on the host.",
  },
  {
    id: "responses",
    client: "Responses client / Codex*",
    endpoint: "POST /v1/responses",
    mode: "Stateless subset → Chat Completions",
    dest: 0,
    note: "Text, function tools and namespaces are translated. *Mock-qualified; real models unverified.",
  },
  {
    id: "messages",
    client: "Anthropic client / Claude*",
    endpoint: "POST /v1/messages",
    mode: "Bounded subset → Chat Completions",
    dest: 0,
    note: "Gateway key via Bearer or x-api-key. *Mock-tested subset; real models unverified.",
  },
  {
    id: "routed",
    client: "Exact-model route match",
    endpoint: 'model: "qwen2.5-coder"',
    mode: "strcmp() match in YAG_MODEL_ROUTES",
    dest: 1,
    note: "Up to 16 exact model IDs dispatch to their own backend with a host-resolved key_env secret.",
  },
];

const SYSTEM_INFO: Array<[string, string]> = [
  ["Binary", "yag · C17 · one process"],
  ["Listener", "127.0.0.1:8080 default"],
  ["Limits", "1 MiB body by default · 16 KiB headers · 32 connections"],
  ["Keys", "1 primary + ≤ 16 scoped"],
  ["Routes", "≤ 16 exact model IDs"],
  ["Stage", `Experimental · reviewed main @ ${PROJECT_REVIEW.revision.slice(0, 7)}`],
  ["Replica pool", "Up to 8 backends · declared model and resource policies"],
];

const LAUNCH: Array<{ to: string; glyph: GlyphName; label: string; sub: string }> = [
  { to: "/architecture", glyph: "explore", label: "Explore", sub: "Architecture schematic" },
  { to: "/protocols", glyph: "protocols", label: "Protocols", sub: "Wire-format explorer" },
  { to: "/source", glyph: "engineering", label: "Engineering", sub: "Source atlas" },
  { to: "/deploy", glyph: "operations", label: "Operations", sub: "Build and verify" },
  { to: "/project", glyph: "project", label: "Project", sub: "MIT · contribute" },
];

const CLIENT_Y = [58, 126, 194, 262];
const DEST_Y = [96, 226];

function Topology({ activeIdx }: { activeIdx: number }) {
  const active = CASES[activeIdx];
  const sel = active.id;
  return <><XmbSectionLabel>Gateway signal topology</XmbSectionLabel>
            <svg
              viewBox="0 0 680 320"
              className="xmb-diagram"
              role="img"
              aria-label="Four client entry paths converge on the YAG host and are dispatched to the default upstream or a model-specific route"
            >
              <g stroke="rgba(255,255,255,0.1)" strokeDasharray="3 5">
                <line x1="215" y1="12" x2="215" y2="308" />
                <line x1="455" y1="12" x2="455" y2="308" />
              </g>
              <g fontFamily="JetBrains Mono, monospace" fontSize="8.5" fill="#ffffff" letterSpacing="1.2">
                <text x="14" y="22">CLIENTS (GATEWAY KEY)</text>
                <text x="275" y="22" fill="#ffffff">HOST BOUNDARY · :8080</text>
                <text x="486" y="22">UPSTREAMS (HOST SECRETS)</text>
              </g>

              {CASES.map((c, i) => {
                const y = CLIENT_Y[i];
                const d = `M 186 ${y} C 228 ${y}, 232 160, 268 160`;
                const on = i === activeIdx;
                return (
                  <g key={c.id}>
                    <path d={d} fill="none" stroke={on ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.14)"} strokeWidth={on ? 1.6 : 1} />
                    {on && <path d={d} fill="none" stroke="#ffffff" strokeWidth="2.2" className="signal-flow" />}
                  </g>
                );
              })}
              {DEST_Y.map((y, di) => {
                const d = `M 404 160 C 442 160, 446 ${y}, 486 ${y}`;
                const on = active.dest === di;
                return (
                  <g key={di}>
                    <path d={d} fill="none" stroke={on ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.14)"} strokeWidth={on ? 1.6 : 1} />
                    {on && <path d={d} fill="none" stroke="#ffffff" strokeWidth="2.2" className="signal-flow" />}
                  </g>
                );
              })}

              {CASES.map((c, i) => {
                const y = CLIENT_Y[i];
                const on = i === activeIdx;
                return (
                  <g key={c.id} >
                    <rect x="14" y={y - 22} width="172" height="44" fill="none" stroke={on ? "#ffffff" : "rgba(255,255,255,0.22)"} strokeWidth={on ? 1.3 : 1} />
                    <text x="24" y={y - 4} fontFamily="Inter, sans-serif" fontSize="11" fontWeight="400" fill="#ffffff">{c.client}</text>
                    <text x="24" y={y + 12} fontFamily="JetBrains Mono, monospace" fontSize="8.5" fill="#ffffff">{c.endpoint}</text>
                  </g>
                );
              })}

              <g>
                <rect x="268" y="56" width="136" height="208" fill="none" stroke="#ffffff" strokeWidth="1.4" />
                <text x="280" y="76" fontFamily="JetBrains Mono, monospace" fontSize="10" fontWeight="400" fill="#ffffff">YAG · C17 HOST</text>
                {[
                  ["01 AUTH", "Bearer / scopes"],
                  ["02 ADAPT", sel === "chat" || sel === "routed" ? "Passthrough" : "→ Chat JSON"],
                  ["03 ROUTE", sel === "routed" ? "Exact match [0]" : "Default upstream"],
                  ["04 CAPS", "1 MiB · 32 conns"],
                ].map(([stage, desc], idx) => {
                  const sy = 96 + idx * 40;
                  return (
                    <g key={stage}>
                      <line x1="278" y1={sy + 28} x2="394" y2={sy + 28} stroke="rgba(255,255,255,0.12)" />
                      <text x="280" y={sy + 8} fontFamily="JetBrains Mono, monospace" fontSize="8" fill="#ffffff">{stage}</text>
                      <text x="280" y={sy + 21} fontFamily="JetBrains Mono, monospace" fontSize="9" fill="#ffffff">{desc}</text>
                    </g>
                  );
                })}
              </g>

              {[
                { title: "Default upstream", sub: "YAG_UPSTREAM_URL (/v1)", tag: "Ollama · vLLM · llama.cpp" },
                { title: "Model routes [0..15]", sub: "YAG_MODEL_ROUTES", tag: "key_env resolved on host" },
              ].map((b, di) => {
                const y = DEST_Y[di];
                const on = active.dest === di;
                return (
                  <g key={b.title}>
                    <rect x="486" y={y - 28} width="180" height="56" fill="none" stroke={on ? "#ffffff" : "rgba(255,255,255,0.22)"} strokeWidth={on ? 1.3 : 1} />
                    <text x="496" y={y - 9} fontFamily="Inter, sans-serif" fontSize="11" fontWeight="400" fill="#ffffff">{b.title}</text>
                    <text x="496" y={y + 6} fontFamily="JetBrains Mono, monospace" fontSize="8.5" fill="#ffffff">{b.sub}</text>
                    <text x="496" y={y + 19} fontFamily="JetBrains Mono, monospace" fontSize="8" fill="#ffffff">{b.tag}</text>
                  </g>
                );
              })}
            </svg>
    <p>{active.mode}</p><p>{active.note}</p></>;
}

export function HomePage() {
  const sections: XmbScreenSection[] = [
    { id: "gateway", label: "Gateway", entries: [
      { key: "overview", title: "About YAG", value: "C17 gateway", description: "Authenticate, route and translate. Upstream credentials stay on the host.", panel: <>
        <p>YAG is a single C17 binary between your applications and the OpenAI-compatible servers you run. It authenticates clients, selects exact-model routes, forwards Chat Completions, and translates bounded Responses and Anthropic Messages subsets. It never runs a model or a tool.</p>
        <p>The project now includes an optional Desktop client, a local operator Console, managed client keys and provider pools. GPU-aware admission can use supported sensors; declared replica budgets remain estimates.</p>
        <p>Experimental: no native TLS, configurable CORS or independent security audit. An optional private admin event trail exists; real-model compatibility remains unqualified.</p>
        <p className="xmb-document-meta">Project knowledge reviewed {PROJECT_REVIEW.date} · main @ {PROJECT_REVIEW.revision.slice(0, 7)}</p>
      </> },
      { key: "architecture", title: "Open Architecture", value: "Host blueprint", to: "/architecture" },
      { key: "trace", title: "Trace a request", value: "Lifecycle simulator", to: "/lifecycle" },
      { key: "github", title: "GitHub", value: "oakvx/yag", href: REPO_LINKS.repo },
    ] },
    { id: "paths", label: "Signal paths", preview: true, entries: CASES.map((item, index) => ({ key: item.id, title: item.endpoint.replace("POST ", ""), value: item.client, description: item.note, panel: <Topology activeIdx={index} /> })) },
    { id: "system", label: "System", entries: SYSTEM_INFO.map(([title, value]) => ({ key: title, title, value })) },
    { id: "explore", label: "Explore", entries: LAUNCH.map((item) => ({ key: item.to, title: item.label, icon: item.glyph, value: item.sub, to: item.to })) },
  ];
  return <XmbScreen subtitle="Gateway overview" document={sections[0].entries[0].panel} sections={sections.map((section, index) => index === 0 ? { ...section, entries: section.entries.slice(1) } : section)} />;
}
