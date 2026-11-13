import { useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { Container, PageMasthead, StatusBadge } from "@/components/Primitives";
import { BLOB_URL } from "@/data/repository";
import { RouteLink } from "@/router/RouterContext";
import { cn } from "@/utils/cn";

type BackendOutcome = "healthy" | "connect_error" | "http_500" | "circuit_open";

interface SimRoute {
  index: number;
  model: string;
  url: string;
  keyEnv: string;
  purpose: string;
}

const SAMPLE_ROUTES: SimRoute[] = [
  {
    index: 0,
    model: "qwen2.5-coder",
    url: "http://127.0.0.1:9000/v1",
    keyEnv: "YAG_ROUTE_KEY_CODER",
    purpose: "Dedicated vLLM coding server",
  },
  {
    index: 1,
    model: "deepseek-r1-local",
    url: "http://127.0.0.1:9001/v1",
    keyEnv: "YAG_ROUTE_KEY_REASON",
    purpose: "Reasoning server on second GPU",
  },
  {
    index: 2,
    model: "bge-m3",
    url: "http://127.0.0.1:9002/v1",
    keyEnv: "YAG_ROUTE_KEY_EMBED",
    purpose: "Local embeddings server",
  },
];

const PRESET_MODELS = ["qwen2.5-coder", "deepseek-r1-local", "llama3.2", "bge-m3", "qwen2.5-coder:latest"];

const ENV_CONFIG_SNIPPET = `# Secrets live in environment variables; YAG_MODEL_ROUTES references them by name.
export YAG_API_KEY="$(openssl rand -hex 32)"
export YAG_UPSTREAM_URL="http://127.0.0.1:11434/v1"

export YAG_ROUTE_KEY_CODER="secret-for-port-9000"
export YAG_ROUTE_KEY_REASON="secret-for-port-9001"
export YAG_ROUTE_KEY_EMBED="secret-for-port-9002"

export YAG_MODEL_ROUTES='[
  {"model":"qwen2.5-coder","url":"http://127.0.0.1:9000/v1","key_env":"YAG_ROUTE_KEY_CODER"},
  {"model":"deepseek-r1-local","url":"http://127.0.0.1:9001/v1","key_env":"YAG_ROUTE_KEY_REASON"},
  {"model":"bge-m3","url":"http://127.0.0.1:9002/v1","key_env":"YAG_ROUTE_KEY_EMBED"}
]'`;

export function RoutingPage() {
  const [modelInput, setModelInput] = useState("qwen2.5-coder");
  const [outcome, setOutcome] = useState<BackendOutcome>("healthy");
  const [fallbackEnabled, setFallbackEnabled] = useState(false);

  const matchedRoute = SAMPLE_ROUTES.find((r) => r.model === modelInput) ?? null;

  // Compute exact C17 behavior from upstream_for_model() in host/src/inference/openai.c
  let finalDestination = "Default Upstream · http://127.0.0.1:11434/v1 (YAG_UPSTREAM_URL)";
  let finalCredential = "YAG_UPSTREAM_KEY (or none if local Ollama)";
  let finalStatus = "200 OK · Dispatched to default upstream (no route matched)";
  let statusTone: "moss" | "amber" | "rust" = "moss";
  let explanation =
    'config_for_model() scanned routes[0..2] with strcmp(). None matched completely, so original config c (default upstream) was returned.';

  if (matchedRoute) {
    if (outcome === "healthy") {
      finalDestination = `Route [${matchedRoute.index}] · ${matchedRoute.url}`;
      finalCredential = `getenv("${matchedRoute.keyEnv}") attached server-side`;
      finalStatus = "200 OK · Routed to matched model backend";
      statusTone = "amber";
      explanation = `strcmp("${modelInput}", routes[${matchedRoute.index}].model) == 0. Request forwarded with ${matchedRoute.keyEnv}'s value without exposing the URL or secret to the client.`;
    } else if (outcome === "connect_error") {
      if (fallbackEnabled) {
        finalDestination = "Default Upstream · http://127.0.0.1:11434/v1 (via YAG_FALLBACK_TO_DEFAULT=1)";
        finalCredential = "YAG_UPSTREAM_KEY";
        finalStatus = "Fallthrough → Default Upstream (CURLE_COULDNT_CONNECT before HTTP response)";
        statusTone = "amber";
        explanation =
          "Connection setup definitively failed before any HTTP status arrived, and YAG_FALLBACK_TO_DEFAULT=1 is enabled: stats->fallthroughs++ and one attempt is made against default upstream.";
      } else {
        finalDestination = `Route [${matchedRoute.index}] · ${matchedRoute.url} (unreachable)`;
        finalCredential = `getenv("${matchedRoute.keyEnv}")`;
        finalStatus = "502 Bad Gateway · Backend unavailable (fallback disabled)";
        statusTone = "rust";
        explanation =
          "YAG_FALLBACK_TO_DEFAULT defaults to 0: when the matched backend refuses TCP connection, YAG returns 502 without silently rerouting to another server.";
      }
    } else if (outcome === "http_500") {
      finalDestination = `Route [${matchedRoute.index}] · ${matchedRoute.url}`;
      finalCredential = `getenv("${matchedRoute.keyEnv}")`;
      finalStatus = "500 Upstream Error Relayed Verbatim (NEVER retried on default)";
      statusTone = "rust";
      explanation =
        "Even with YAG_FALLBACK_TO_DEFAULT=1, once an upstream HTTP status code is received (or a timeout occurs), YAG NEVER replays the request to default upstream.";
    } else if (outcome === "circuit_open") {
      if (fallbackEnabled) {
        finalDestination = "Default Upstream · http://127.0.0.1:11434/v1 (circuit-open bypass)";
        finalCredential = "YAG_UPSTREAM_KEY";
        finalStatus = "Bypassed Open Circuit → Default Upstream";
        statusTone = "amber";
        explanation =
          "Route tripped YAG_CIRCUIT_THRESHOLD. route_admitted() returned 0 (stats->bypassed++), and YAG_FALLBACK_TO_DEFAULT=1 diverted admission to default upstream.";
      } else {
        finalDestination = `Route [${matchedRoute.index}] suppressed during cooldown`;
        finalCredential = "None sent (suppressed pre-flight)";
        finalStatus = "502 Bad Gateway · Circuit open (stats->bypassed++)";
        statusTone = "rust";
        explanation =
          "Route is in cooldown after consecutive upstream failures. With fallback off, admission fails fast without hammering the failing backend.";
      }
    }
  }

  return (
    <div>
      <PageMasthead
        path="/routing"
        eyebrow="Chapter 05 · Interactive Routing Table"
        title={
          <>
            Exact <code className="font-mono text-[0.82em] text-amber">strcmp()</code> matching. Secrets by reference.
          </>
        }
        lede="Test how YAG selects an upstream server. Choose a preset model ID — or type your own — and simulate backend failures to see when YAG holds firm versus when opt-in connection fallback applies."
        meta={[
          { k: "Max routes", v: "16 unique exact model IDs", tone: "amber" },
          { k: "Secret source", v: "key_env → host getenv() at startup", tone: "moss" },
          { k: "GET /api/routes", v: "Lists model IDs only (redacts URLs)" },
        ]}
      />

      <section className="border-b border-line py-6 @lg:py-8">
        <Container>
          {/* Interactive Routing Bench */}
          <div className="border border-line-strong bg-panel">
            <div className="border-b border-line px-4 py-3 font-mono text-[10px] uppercase tracking-[0.15em] flex flex-wrap justify-between gap-2">
              <span className="text-amber">Interactive Simulator · config_for_model() & upstream_for_model()</span>
              <span className="text-faint">Sample data in browser memory — zero network calls</span>
            </div>

            {/* Controls Row */}
            <div className="grid gap-6 border-b border-line p-4 @lg:p-6 @3xl:grid-cols-12">
              {/* Left: Model Selector & Custom Input */}
              <div className="@3xl:col-span-6">
                <label htmlFor="model-selector-input" className="label block text-faint">
                  01 · Incoming Request &quot;model&quot; Field
                </label>
                <input
                  id="model-selector-input"
                  type="text"
                  value={modelInput}
                  onChange={(e) => setModelInput(e.target.value)}
                  className="mt-2 w-full border border-line-strong bg-ink px-3.5 py-2 font-mono text-[13px] text-paper focus:border-amber focus:outline-none"
                  placeholder="Type a model ID..."
                />
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {PRESET_MODELS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setModelInput(preset)}
                      className={cn(
                        "border px-2 py-1 font-mono text-[10px] transition-colors cursor-pointer",
                        modelInput === preset
                          ? "border-amber bg-amber/15 text-paper"
                          : "border-line text-faint hover:text-paper",
                      )}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <p className="mt-2 font-mono text-[10.5px] text-faint">
                  Notice <code className="text-paper">qwen2.5-coder:latest</code> vs{" "}
                  <code className="text-paper">qwen2.5-coder</code>: there is no prefix or tag wildcarding.
                </p>
              </div>

              {/* Right: Simulated Route Condition & Fallback Flag */}
              <div className="@3xl:col-span-6 @3xl:border-l @3xl:border-line @3xl:pl-6">
                <span className="label block text-faint">02 · Simulated Matched-Backend Condition</span>
                <div className="mt-2 grid grid-cols-2 gap-1.5 font-mono text-[10.5px]">
                  {[
                    { id: "healthy", label: "Healthy (HTTP 200)" },
                    { id: "connect_error", label: "TCP Connect Refused" },
                    { id: "http_500", label: "Upstream HTTP 500" },
                    { id: "circuit_open", label: "Circuit Breaker Open" },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setOutcome(opt.id as BackendOutcome)}
                      className={cn(
                        "border px-2.5 py-1.5 text-left transition-colors cursor-pointer",
                        outcome === opt.id
                          ? "border-amber bg-amber/15 text-paper"
                          : "border-line text-faint hover:text-paper",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                <label className="mt-3 flex items-center gap-2.5 font-mono text-[11px] text-paper cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fallbackEnabled}
                    onChange={(e) => setFallbackEnabled(e.target.checked)}
                    className="accent-[#6ccbff]"
                  />
                  <span>YAG_FALLBACK_TO_DEFAULT={fallbackEnabled ? "1" : "0"}</span>
                </label>
              </div>
            </div>

            {/* Visual Routing Table Lookup */}
            <div className="grid @3xl:grid-cols-12">
              <div className="border-b border-line p-4 @lg:p-6 @3xl:col-span-7 @3xl:border-b-0 @3xl:border-r">
                <p className="label mb-3 text-faint">Startup-Validated Route Table (c-&gt;routes[0..2])</p>
                <div className="divide-y divide-line border border-line bg-ink">
                  {SAMPLE_ROUTES.map((r) => {
                    const isMatch = matchedRoute?.index === r.index;
                    return (
                      <div
                        key={r.model}
                        onClick={() => setModelInput(r.model)}
                        className={cn(
                          "grid grid-cols-12 items-center gap-2 px-3.5 py-3 font-mono text-[11px] transition-colors cursor-pointer",
                          isMatch ? "bg-amber/[0.12]" : "hover:bg-paper/[0.02]",
                        )}
                      >
                        <div className="col-span-1 text-faint">[{r.index}]</div>
                        <div className="col-span-4 truncate text-paper font-medium">{r.model}</div>
                        <div className="col-span-4 truncate text-muted">{r.url}</div>
                        <div className="col-span-3 text-right">
                          <span
                            className={cn(
                              "border px-1.5 py-0.5 text-[9.5px]",
                              isMatch ? "border-amber text-amber" : "border-line text-faint",
                            )}
                          >
                            {isMatch ? "strcmp == 0" : "no match"}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {/* Default Fallback Row */}
                  <div
                    className={cn(
                      "grid grid-cols-12 items-center gap-2 px-3.5 py-3 font-mono text-[11px]",
                      !matchedRoute ? "bg-moss/[0.12]" : "opacity-65",
                    )}
                  >
                    <div className="col-span-1 text-faint">[def]</div>
                    <div className="col-span-4 text-paper">* (all unmatched)</div>
                    <div className="col-span-4 truncate text-muted">http://127.0.0.1:11434/v1</div>
                    <div className="col-span-3 text-right">
                      <span
                        className={cn(
                          "border px-1.5 py-0.5 text-[9.5px]",
                          !matchedRoute ? "border-moss text-moss" : "border-line text-faint",
                        )}
                      >
                        {!matchedRoute ? "selected" : "standby"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Resulting Dispatch Readout */}
              <div className="bg-[rgba(3,12,34,0.62)] p-4 @lg:p-6 @3xl:col-span-5" aria-live="polite">
                <p className="label text-amber">Dispatch Resolution</p>
                <div
                  className={cn(
                    "mt-3 border p-3.5 font-mono text-[11.5px]",
                    statusTone === "moss"
                      ? "border-moss/50 bg-moss/[0.07] text-moss"
                      : statusTone === "amber"
                        ? "border-amber/50 bg-amber/[0.07] text-amber"
                        : "border-rust/50 bg-rust/[0.07] text-rust",
                  )}
                >
                  {finalStatus}
                </div>

                <dl className="mt-4 space-y-2.5 font-mono text-[11px]">
                  <div>
                    <dt className="text-faint uppercase text-[9.5px]">Selected Target URL</dt>
                    <dd className="mt-0.5 text-paper">{finalDestination}</dd>
                  </div>
                  <div>
                    <dt className="text-faint uppercase text-[9.5px]">Host-Attached Secret</dt>
                    <dd className="mt-0.5 text-paper">{finalCredential}</dd>
                  </div>
                  <div>
                    <dt className="text-faint uppercase text-[9.5px]">What GET /api/routes Returns to Clients</dt>
                    <dd className="mt-0.5 text-muted">
                      {`{"object":"list","data":[{"model":"qwen2.5-coder"}, ...]}`} (no URLs, no key_env)
                    </dd>
                  </div>
                </dl>

                <p className="mt-4 border-t border-line pt-3 text-[12.5px] leading-relaxed text-muted">{explanation}</p>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* REAL CONFIGURATION & CAVEATS */}
      <section className="py-6 @lg:py-8">
        <Container>
          <div className="grid gap-10 @3xl:grid-cols-12">
            <div className="@3xl:col-span-7">
              <p className="label text-amber">Startup Environment Definition</p>
              <h2 className="display mt-2 text-2xl text-paper @lg:text-3xl">
                Secrets stay out of JSON via <code className="font-mono text-[0.82em] text-amber">key_env</code>.
              </h2>
              <div className="mt-4">
                <CodeBlock
                  code={ENV_CONFIG_SNIPPET}
                  lang="bash"
                  path="README.md · Multi-backend routing"
                  href={`${BLOB_URL}/README.md`}
                  highlights={[4, 5, 8, 9]}
                  showLineNumbers={false}
                />
              </div>
            </div>

            <div className="@3xl:col-span-5 space-y-5">
              <div className="border-t border-line-strong pt-4">
                <StatusBadge tone="absent">What Model Routing Does Not Do</StatusBadge>
                <ul className="mt-3 space-y-2.5 text-[13.5px] leading-relaxed text-muted">
                  <li>
                    <strong className="text-paper">No aggregate backend discovery:</strong>{" "}
                    <code className="font-mono text-[12px]">GET /v1/models</code> queries only the default upstream and
                    appends the static <code className="font-mono text-[12px]">YAG_MODEL_ROUTES</code> model strings.
                  </li>
                  <li>
                    <strong className="text-paper">No post-response replay:</strong> timeouts and HTTP 4xx/5xx responses
                    from a matched route are never transparently retried on another backend.
                  </li>
                  <li>
                    <strong className="text-paper">No live route editing:</strong> routes are parsed once in{" "}
                    <code className="font-mono text-[12px]">load_routes()</code> at startup; updates require restarting
                    the binary.
                  </li>
                </ul>
                <div className="mt-5">
                  <RouteLink to="/source?file=config-routes" className="btn btn-outline">
                    Read config_for_model() in Source Explorer →
                  </RouteLink>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}
