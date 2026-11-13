import { useState } from "react";
import { StatusBadge } from "@/components/Primitives";
import { REPO_LINKS } from "@/data/repository";
import { RouteLink } from "@/router/RouterContext";
import { Glyph } from "@/xmb/Glyphs";
import type { GlyphName } from "@/xmb/categories";
import { cn } from "@/utils/cn";

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
  ["Limits", "1 MiB · 16 KiB · 32 conns"],
  ["Keys", "1 primary + ≤ 16 scoped"],
  ["Routes", "≤ 16 exact model IDs"],
  ["Stage", "Experimental · v0.1.0"],
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

export function HomePage() {
  const [sel, setSel] = useState<CaseId>("chat");
  const active = CASES.find((c) => c.id === sel) ?? CASES[0];
  const activeIdx = CASES.findIndex((c) => c.id === sel);

  return (
    <div className="grid gap-5 p-5 @lg:p-7 @3xl:grid-cols-12">
      {/* Identity */}
      <section className="flex flex-col justify-between gap-6 @3xl:col-span-5" aria-labelledby="home-title">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="mock">Experimental</StatusBadge>
            <span className="rounded-full border border-line px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.13em] text-muted">
              MIT
            </span>
            <span className="rounded-full border border-line px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.13em] text-muted">
              C17 host
            </span>
          </div>

          <h1 id="home-title" className="display mt-4 text-[2.3rem] text-paper @2xl:text-[2.8rem]">
            Your models. Your endpoints. <em>One gateway.</em>
          </h1>

          <p className="mt-4 text-[14px] leading-[1.7] text-muted">
            YAG is a single C17 binary between your applications and the OpenAI-compatible servers you run. It
            authenticates clients, selects exact-model routes, forwards Chat Completions, and translates bounded
            Responses and Anthropic Messages subsets — keeping upstream credentials on the host. It never runs a
            model or a tool.
          </p>

          <div className="mt-5 flex flex-wrap gap-2.5">
            <RouteLink to="/architecture" className="btn btn-primary">
              Open Architecture <span aria-hidden="true">→</span>
            </RouteLink>
            <RouteLink to="/lifecycle" className="btn btn-amber">
              Trace a request
            </RouteLink>
            <a href={REPO_LINKS.repo} target="_blank" rel="noreferrer noopener" className="btn btn-outline">
              GitHub <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>

        <p className="border-l-2 border-rust/70 pl-3.5 font-mono text-[11px] leading-relaxed text-faint">
          <span className="uppercase tracking-[0.13em] text-rust">Foundation, not a fortress:</span> no native TLS, CORS
          configuration, audit log or independent security audit. Automated suites run against a deterministic mock
          upstream.
        </p>
      </section>

      {/* Interactive topology */}
      <section className="@3xl:col-span-7" aria-label="Gateway topology">
        <div className="overflow-hidden rounded-2xl border border-line-strong bg-ink">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.15em]">
            <span className="text-amber">Fig. 00 · Gateway signal topology</span>
            <span className="text-faint">Select an entry path</span>
          </div>

          <div role="tablist" aria-label="Entry path" className="grid grid-cols-2 border-b border-line @2xl:grid-cols-4">
            {CASES.map((c, i) => {
              const on = c.id === sel;
              return (
                <button
                  key={c.id}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setSel(c.id)}
                  className={cn(
                    "cursor-pointer border-b border-r border-line px-3 py-2 text-left font-mono text-[10px] transition-colors @2xl:border-b-0 @2xl:last:border-r-0",
                    on ? "bg-amber/[0.14] text-paper" : "text-faint hover:bg-white/[0.04] hover:text-muted",
                  )}
                >
                  <span className={on ? "text-amber" : "text-faint"}>0{i + 1}</span>
                  <div className="mt-0.5 truncate text-[11px]">{c.endpoint.replace("POST ", "")}</div>
                </button>
              );
            })}
          </div>

          <div className="p-3 @lg:p-4">
            <svg
              viewBox="0 0 680 320"
              className="h-auto w-full"
              role="img"
              aria-label="Four client entry paths converge on the YAG host and are dispatched to the default upstream or a model-specific route"
            >
              <g stroke="rgba(190,220,255,0.1)" strokeDasharray="3 5">
                <line x1="215" y1="12" x2="215" y2="308" />
                <line x1="455" y1="12" x2="455" y2="308" />
              </g>
              <g fontFamily="JetBrains Mono, monospace" fontSize="8.5" fill="#7F98BC" letterSpacing="1.2">
                <text x="14" y="22">CLIENTS (GATEWAY KEY)</text>
                <text x="275" y="22" fill="#6CCBFF">HOST BOUNDARY · :8080</text>
                <text x="486" y="22">UPSTREAMS (HOST SECRETS)</text>
              </g>

              {CASES.map((c, i) => {
                const y = CLIENT_Y[i];
                const d = `M 186 ${y} C 228 ${y}, 232 160, 268 160`;
                const on = i === activeIdx;
                return (
                  <g key={c.id}>
                    <path d={d} fill="none" stroke={on ? "rgba(108,203,255,0.5)" : "rgba(190,220,255,0.14)"} strokeWidth={on ? 1.6 : 1} />
                    {on && <path d={d} fill="none" stroke="#9fe1ff" strokeWidth="2.2" className="signal-flow" />}
                  </g>
                );
              })}
              {DEST_Y.map((y, di) => {
                const d = `M 404 160 C 442 160, 446 ${y}, 486 ${y}`;
                const on = active.dest === di;
                return (
                  <g key={di}>
                    <path d={d} fill="none" stroke={on ? "rgba(108,203,255,0.5)" : "rgba(190,220,255,0.14)"} strokeWidth={on ? 1.6 : 1} />
                    {on && <path d={d} fill="none" stroke="#9fe1ff" strokeWidth="2.2" className="signal-flow" />}
                  </g>
                );
              })}

              {CASES.map((c, i) => {
                const y = CLIENT_Y[i];
                const on = i === activeIdx;
                return (
                  <g key={c.id} className="cursor-pointer" onClick={() => setSel(c.id)}>
                    <rect x="14" y={y - 22} width="172" height="44" rx="10" fill={on ? "rgba(60,140,230,0.3)" : "rgba(10,30,74,0.7)"} stroke={on ? "#6CCBFF" : "rgba(190,220,255,0.22)"} strokeWidth={on ? 1.3 : 1} />
                    <text x="24" y={y - 4} fontFamily="Inter, sans-serif" fontSize="11" fontWeight="500" fill="#EAF4FF">{c.client}</text>
                    <text x="24" y={y + 12} fontFamily="JetBrains Mono, monospace" fontSize="8.5" fill="#A9C1E0">{c.endpoint}</text>
                  </g>
                );
              })}

              <g>
                <rect x="268" y="56" width="136" height="208" rx="12" fill="rgba(14,40,96,0.8)" stroke="#6CCBFF" strokeWidth="1.4" />
                <text x="280" y="76" fontFamily="JetBrains Mono, monospace" fontSize="10" fontWeight="600" fill="#EAF4FF">YAG · C17 HOST</text>
                {[
                  ["01 AUTH", "Bearer / scopes"],
                  ["02 ADAPT", sel === "chat" || sel === "routed" ? "Passthrough" : "→ Chat JSON"],
                  ["03 ROUTE", sel === "routed" ? "Exact match [0]" : "Default upstream"],
                  ["04 CAPS", "1 MiB · 32 conns"],
                ].map(([stage, desc], idx) => {
                  const sy = 96 + idx * 40;
                  return (
                    <g key={stage}>
                      <line x1="278" y1={sy + 28} x2="394" y2={sy + 28} stroke="rgba(190,220,255,0.12)" />
                      <text x="280" y={sy + 8} fontFamily="JetBrains Mono, monospace" fontSize="8" fill="#6CCBFF">{stage}</text>
                      <text x="280" y={sy + 21} fontFamily="JetBrains Mono, monospace" fontSize="9" fill="#EAF4FF">{desc}</text>
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
                    <rect x="486" y={y - 28} width="180" height="56" rx="10" fill={on ? "rgba(60,140,230,0.3)" : "rgba(10,30,74,0.7)"} stroke={on ? "#6CCBFF" : "rgba(190,220,255,0.22)"} strokeWidth={on ? 1.3 : 1} />
                    <text x="496" y={y - 9} fontFamily="Inter, sans-serif" fontSize="11" fontWeight="500" fill="#EAF4FF">{b.title}</text>
                    <text x="496" y={y + 6} fontFamily="JetBrains Mono, monospace" fontSize="8.5" fill="#6CCBFF">{b.sub}</text>
                    <text x="496" y={y + 19} fontFamily="JetBrains Mono, monospace" fontSize="8" fill="#7F98BC">{b.tag}</text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="grid gap-2 border-t border-line bg-black/20 px-4 py-3 font-mono text-[11px] @2xl:grid-cols-12" aria-live="polite">
            <div className="@2xl:col-span-5">
              <span className="text-amber">ACTIVE PATH:</span> <span className="text-paper">{active.mode}</span>
            </div>
            <div className="text-muted @2xl:col-span-7">{active.note}</div>
          </div>
        </div>
      </section>

      {/* System information */}
      <section className="@3xl:col-span-12" aria-label="System information">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line @2xl:grid-cols-3 @4xl:grid-cols-6">
          {SYSTEM_INFO.map(([k, v]) => (
            <div key={k} className="bg-[rgba(6,20,54,0.7)] px-4 py-3">
              <dt className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-faint">{k}</dt>
              <dd className="mt-1 font-mono text-[11.5px] text-paper">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Launcher */}
      <nav className="@3xl:col-span-12" aria-label="Project areas">
        <ul className="grid gap-2 @lg:grid-cols-2 @3xl:grid-cols-5">
          {LAUNCH.map((l) => (
            <li key={l.to}>
              <RouteLink
                to={l.to}
                className="group flex items-center gap-3 rounded-2xl border border-line bg-white/[0.03] px-3.5 py-2.5 transition-all duration-300 hover:border-amber/60 hover:bg-amber/[0.1]"
              >
                <Glyph name={l.glyph} className="h-6 w-6 text-muted transition-colors group-hover:text-white" />
                <span className="min-w-0">
                  <span className="block font-serif text-[15px] text-paper">{l.label}</span>
                  <span className="block truncate text-[11.5px] text-faint">{l.sub}</span>
                </span>
              </RouteLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
