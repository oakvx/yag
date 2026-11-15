import { useState } from "react";
import { XmbScreen, XmbSectionLabel } from "@/components/XmbScreen";
import { XmbRow } from "@/components/XmbRow";
import { CodeBlock } from "@/components/CodeBlock";
import { BLOB_URL } from "@/data/repository";

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
  let explanation =
    'config_for_model() scanned routes[0..2] with strcmp(). None matched completely, so original config c (default upstream) was returned.';

  if (matchedRoute) {
    if (outcome === "healthy") {
      finalDestination = `Route [${matchedRoute.index}] · ${matchedRoute.url}`;
      finalCredential = `getenv("${matchedRoute.keyEnv}") attached server-side`;
      finalStatus = "200 OK · Routed to matched model backend";
      explanation = `strcmp("${modelInput}", routes[${matchedRoute.index}].model) == 0. Request forwarded with ${matchedRoute.keyEnv}'s value without exposing the URL or secret to the client.`;
    } else if (outcome === "connect_error") {
      if (fallbackEnabled) {
        finalDestination = "Default Upstream · http://127.0.0.1:11434/v1 (via YAG_FALLBACK_TO_DEFAULT=1)";
        finalCredential = "YAG_UPSTREAM_KEY";
        finalStatus = "Fallthrough → Default Upstream (CURLE_COULDNT_CONNECT before HTTP response)";
        explanation =
          "Connection setup definitively failed before any HTTP status arrived, and YAG_FALLBACK_TO_DEFAULT=1 is enabled: stats->fallthroughs++ and one attempt is made against default upstream.";
      } else {
        finalDestination = `Route [${matchedRoute.index}] · ${matchedRoute.url} (unreachable)`;
        finalCredential = `getenv("${matchedRoute.keyEnv}")`;
        finalStatus = "502 Bad Gateway · Backend unavailable (fallback disabled)";
        explanation =
          "YAG_FALLBACK_TO_DEFAULT defaults to 0: when the matched backend refuses TCP connection, YAG returns 502 without silently rerouting to another server.";
      }
    } else if (outcome === "http_500") {
      finalDestination = `Route [${matchedRoute.index}] · ${matchedRoute.url}`;
      finalCredential = `getenv("${matchedRoute.keyEnv}")`;
      finalStatus = "500 Upstream Error Relayed Verbatim (NEVER retried on default)";
      explanation =
        "Even with YAG_FALLBACK_TO_DEFAULT=1, once an upstream HTTP status code is received (or a timeout occurs), YAG NEVER replays the request to default upstream.";
    } else if (outcome === "circuit_open") {
      if (fallbackEnabled) {
        finalDestination = "Default Upstream · http://127.0.0.1:11434/v1 (circuit-open bypass)";
        finalCredential = "YAG_UPSTREAM_KEY";
        finalStatus = "Bypassed Open Circuit → Default Upstream";
        explanation =
          "Route tripped YAG_CIRCUIT_THRESHOLD. route_admitted() returned 0 (stats->bypassed++), and YAG_FALLBACK_TO_DEFAULT=1 diverted admission to default upstream.";
      } else {
        finalDestination = `Route [${matchedRoute.index}] suppressed during cooldown`;
        finalCredential = "None sent (suppressed pre-flight)";
        finalStatus = "502 Bad Gateway · Circuit open (stats->bypassed++)";
        explanation =
          "Route is in cooldown after consecutive upstream failures. With fallback off, admission fails fast without hammering the failing backend.";
      }
    }
  }

  const result = <><XmbSectionLabel>Dispatch resolution</XmbSectionLabel><p aria-live="polite">{finalStatus}</p>
    <dl className="xmb-facts"><div><dt>Target</dt><dd>{finalDestination}</dd></div><div><dt>Host credential</dt><dd>{finalCredential}</dd></div></dl>
    <p>{explanation}</p>
    <XmbSectionLabel>Startup route table</XmbSectionLabel>
    {SAMPLE_ROUTES.map((route) => <XmbRow key={route.model} onClick={() => setModelInput(route.model)} value={matchedRoute?.index === route.index ? "Exact match" : route.url} hint={route.purpose}>{route.model}</XmbRow>)}
    <p>GET /api/routes returns model IDs only, never URLs or key_env names.</p>
  </>;
  return <XmbScreen document={<p>YAG chooses backends by exact model ID. Secrets stay in the host environment and routes reference them by name. Try a model and a backend condition below to see when a request is dispatched, rejected or retried on the default upstream.</p>} subtitle="Exact model matching and opt-in fallback. Sample data in browser memory; no network calls." sections={[
    { id: "model", label: "Model", panel: result, entries: [
      ...PRESET_MODELS.map((model) => ({ key: model, title: model, value: modelInput === model ? "Selected" : "Use model", activate: () => setModelInput(model), description: "Select this exact model ID. Tags and prefixes are not wildcard matches." })),
      { key: "custom", title: "Custom model ID", value: modelInput, description: "Type a model ID in the field below; Escape returns to the selection.", panel: <>
        <label className="xmb-field" htmlFor="model-selector-input">Incoming request model
          <input id="model-selector-input" value={modelInput} onChange={(event) => setModelInput(event.target.value)} data-info="Type an exact model ID. Escape returns to the row." onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); event.currentTarget.closest(".xmb-screen")?.querySelector<HTMLElement>(".is-selected .xmb-list-link")?.focus(); }
          }} />
        </label>{result}</> },
    ] },
    { id: "condition", label: "Backend condition", panel: result, entries: [
      ...([{ id: "healthy", label: "Healthy · HTTP 200" }, { id: "connect_error", label: "TCP connect refused" }, { id: "http_500", label: "Upstream HTTP 500" }, { id: "circuit_open", label: "Circuit breaker open" }] as const).map((item) => ({ key: item.id, title: item.label, value: outcome === item.id ? "Selected" : "Simulate", activate: () => setOutcome(item.id), description: "Change the matched backend condition; unmatched models still use the default upstream." })),
      { key: "fallback", title: "Fallback to default", value: fallbackEnabled ? "On" : "Off", activate: () => setFallbackEnabled((value) => !value), description: "Toggle fallback for connection setup failures or open circuits. HTTP responses are never replayed." },
    ] },
    { id: "configuration", label: "Configuration", entries: [
      { key: "environment", title: "Startup environment", value: "key_env", description: "Secrets stay out of route JSON; resolve environment references on the host.", panel: <CodeBlock code={ENV_CONFIG_SNIPPET} lang="bash" path="README.md · Multi-backend routing" href={`${BLOB_URL}/README.md`} showLineNumbers={false} /> },
      { key: "limits", title: "Routing boundaries", value: "Static routes and managed pools", panel: <><p>This simulator covers exact-model routes and the single default upstream. The host also supports a model-aware replica pool. Enabled dedicated model IDs participate in discovery and cannot fall back to a generic backend; declarations do not verify model capabilities.</p><p>Static exact-model routes require restart. The private Provider Manager can edit stored pool replicas when no pool work is active or waiting. Timeouts and HTTP errors are never replayed. Capacity exhaustion and per-run request quotas are admission failures, not automatic failover or financial budgets.</p><XmbRow to="/source?file=config-routes">Read config_for_model()</XmbRow><XmbRow to="/source?file=pool-admission">Read replica admission</XmbRow></> },
    ] },
  ]} />;
}
