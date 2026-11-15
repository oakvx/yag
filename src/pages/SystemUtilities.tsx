import { XmbRow } from "@/components/XmbRow";
import { CodeBlock } from "@/components/CodeBlock";
import { BLOB_URL, REPO_LINKS } from "@/data/repository";
import { XmbScreen, type XmbScreenEntry } from "@/components/XmbScreen";
import { PROJECT_REVIEW } from "@/data/projectKnowledge";

/**
 * The three System Screens, drawn the way the console draws its own
 * Settings: a lede, the console's list (cursor row standing a size larger),
 * a small note. No cards, no pills, no header panel — the wave shows
 * through and monospace appears only where code does.
 */

const SPECIFICATIONS: Array<[string, string]> = [
  ["Project", "YAG - Yet Another Gateway"],
  ["Project version", "0.1.0 (CMake project definition)"],
  ["Reviewed source", `main @ ${PROJECT_REVIEW.revision.slice(0, 7)} · ${PROJECT_REVIEW.date}`],
  ["Desktop client", "Optional Windows, macOS and Linux client; no local model execution"],
  ["Replica pool", "Up to 8 backends; model policies and declared resource reservations"],
  ["Qualification", "Experimental; real inference-model compatibility is unverified"],
  ["Native host", "C17, POSIX sockets, libcurl, pthreads"],
  ["JSON implementation", "yyjson 0.12.0, vendored under third_party/yyjson"],
  ["Browser Console", "Optional React + TypeScript bundle, served by the native host"],
  ["Default listen address", "127.0.0.1:8080 (HTTP)"],
  ["Request limits", "16 KiB headers; 1 MiB default body; 32 concurrent connections"],
  ["Model routes", "Up to 16 exact model identifiers"],
  ["Credentials", "One primary key and up to 16 scoped extra keys"],
  ["Model execution", "Not provided; the inference server runs models"],
  ["Tool execution", "Not provided; clients execute their own tools"],
  ["License", "MIT"],
];

export function SystemInfoPage() {
  const entries: XmbScreenEntry[] = SPECIFICATIONS.map(([label, value]) => ({
    key: label,
    title: label,
    value,
    description: value,
    ariaLabel: `${label}: ${value}`,
  }));
  return <XmbScreen testId="system-info" subtitle="Specifications from the repository, not live telemetry from a running host." sections={[{ id: "system-info", label: "System specifications", entries, panel: <p>These values describe the software. Architecture and implementation status is available in the repository.</p> }]} />;
}

const VARIABLES = [
  { name: "YAG_API_KEY", value: "Required", text: "Primary gateway bearer secret. At least 16 characters, without newlines." },
  { name: "YAG_BIND", value: "127.0.0.1", text: "Local listen address. Non-loopback binds print an unencrypted-HTTP warning." },
  { name: "YAG_PORT", value: "8080", text: "The native host's listen port. The API and optional Console share this listener." },
  { name: "YAG_UPSTREAM_URL", value: "http://127.0.0.1:8000/v1", text: "OpenAI-compatible upstream base URL. No trailing slash, query or fragment." },
  { name: "YAG_UPSTREAM_KEY", value: "Empty", text: "Optional upstream bearer secret. Attached by libcurl on the host, never returned to clients." },
  { name: "YAG_MODEL_ROUTES", value: "Empty", text: "Startup JSON array of up to 16 unique exact-model routes: model, url and optional key_env." },
  { name: "YAG_EXTRA_API_KEYS", value: "Empty", text: "Up to 16 comma-separated extra secrets, each at least 16 characters. Duplicates are rejected." },
  { name: "YAG_EXTRA_KEY_SCOPES", value: "Full access if unset", text: "Positional scopes: all, inference, models, monitor or inference+models." },
  { name: "YAG_TIMEOUT", value: "120 seconds", text: "Total upstream timeout (1-3600 seconds). The connect timeout is 10 seconds." },
  { name: "YAG_HEADER_DEADLINE_SECONDS", value: "10 seconds", text: "Monotonic absolute header-read deadline (1-300 seconds)." },
  { name: "YAG_BODY_DEADLINE_SECONDS", value: "30 seconds", text: "Monotonic absolute body-read deadline (1-3600 seconds)." },
  { name: "YAG_MAX_BODY_BYTES", value: "1048576", text: "1 MiB default body bound; configurable from 65536 to 8388608 bytes." },
  { name: "YAG_RATE_LIMIT_PER_MINUTE", value: "0 (disabled)", text: "Per-key fixed 60-second windows. When exceeded, returns 429 and Retry-After." },
  { name: "YAG_FALLBACK_TO_DEFAULT", value: "0 (disabled)", text: "Optional connection/DNS-setup fallback before any HTTP response; never replays ambiguous timeouts or HTTP errors." },
  { name: "YAG_CIRCUIT_THRESHOLD", value: "0 (disabled)", text: "Optional admission breaker: 1-20 consecutive failures can suppress a routed provider." },
  { name: "YAG_CIRCUIT_COOLDOWN_SECONDS", value: "30 seconds", text: "An open route waits before one half-open request probes recovery." },
  { name: "YAG_ASSETS", value: "console/dist", text: "Optional Console assets relative to the native host's working directory." },
  { name: "YAG_CLIENT_STORE", value: "Disabled", text: "Private managed-client registry. Enables runtime issuance, disable and revocation of managed keys; static environment keys remain startup configuration." },
  { name: "YAG_PROVIDER_STORE", value: "Disabled", text: "Private persisted replica registry. Live edits require idle pool work and the primary administrator key." },
  { name: "YAG_ADMIN_AUDIT_FILE", value: "Disabled", text: "Opt-in private JSONL administrative response events. Excludes request bodies, API keys and client identities." },
  { name: "YAG_MAX_INFERENCE", value: "0 standalone; 6 LAN", text: "Global inference ceiling. The standalone scheduler is disabled by default; the LAN profile enables bounded admission." },
  { name: "YAG_ADAPTIVE_SCHEDULER", value: "0 standalone; 1 LAN", text: "Optional GPU-aware admission under the static ceiling. Requires a positive YAG_MAX_INFERENCE; missing VRAM sensors retain the static capacity." },
  { name: "YAG_GPU_REQUEST_VRAM_MB", value: "1024 MiB", text: "Operator-supplied incremental allowance per admitted request, not a verified model memory requirement." },
  { name: "YAG_GPU_VRAM_MARGIN_PERCENT", value: "10%", text: "Measured total VRAM fraction reserved as headroom. Accepted range 0–50%. Backend OOM remains possible." },
  { name: "YAG_POOL_WAIT_MS", value: "0", text: "Optional bounded wait for replica resources, up to 30000 ms. Saturated pool admission is distinct from upstream transport failure." },
];

export function ConfigurationPage() {
  const entries: XmbScreenEntry[] = VARIABLES.map((v) => ({
    key: v.name,
    title: v.name,
    value: v.value,
    description: v.text,
    detail: (
      <>
        <p>{v.text}</p>
        <XmbRow href={`${BLOB_URL}/host/src/core/config.c`}>
          host/src/core/config.c
        </XmbRow>
        <p>
          Never commit secrets to public files. Plain HTTP on an untrusted network exposes
          gateway keys and request traffic.
        </p>
      </>
    ),
    ariaLabel: `${v.name}, default ${v.value}`,
  }));
  return <XmbScreen testId="configuration" subtitle="Startup environment reference. Restart the host to apply static configuration changes." sections={[{ id: "configuration", label: "Startup environment settings", entries }]} />;
}

const OPERATIONS = [
  { path: "/health", auth: "Public", description: "Process liveness only. It does not certify that a model or upstream is healthy." },
  { path: "/api/status", auth: "Gateway key", description: "Host status and process-level information." },
  { path: "/api/routes", auth: "Gateway key", description: "Configured model IDs, with upstream URLs and credentials omitted." },
  { path: "/api/metrics", auth: "Monitoring permission", description: "In-memory request counters by protocol. Attempts are not successful generations." },
  { path: "/api/clients", auth: "Monitoring permission", description: "Per-key accepted and throttled counts, positional labels and scopes. No prompts or secrets." },
  { path: "/api/providers/status", auth: "Monitoring permission", description: "Passive attempts, failures, reported usage, latency and circuit state per provider." },
  { path: "/api/capabilities", auth: "Gateway key", description: "Gateway protocol and limit support, not live model capability discovery." },
  { path: "/api/providers/pool", auth: "Monitoring permission", description: "Replica model policies, admission reservations and saturation counters; resource budgets are operator estimates." },
  { path: "/api/system/resources", auth: "Monitoring permission", description: "Available resource telemetry with explicit scope and sensor availability. Missing data does not mean zero usage." },
  { path: "/api/scheduler", auth: "Monitoring permission", description: "Configured and effective inference capacities, queue state and adaptive sensor availability." },
];

export function OperationsPage() {
  const entries: XmbScreenEntry[] = OPERATIONS.map((op, i) => ({
    key: op.path,
    title: `GET ${op.path}`,
    sub: op.auth,
    description: op.description,
    detail: (
      <>
        <p>{op.description}</p>
        <CodeBlock
          code={`curl http://127.0.0.1:8080${op.path}${i > 0 ? ' \\\n  -H "Authorization: Bearer $YAG_API_KEY"' : ""}`}
          lang="bash"
          path="Operator command - not executed here"
          showLineNumbers={false}
        />
        <p>
          Counters are ephemeral and reset on restart. Reported token counts come from upstream
          usage fields, not estimates. A successful /models probe only establishes reachability.
        </p>
        <XmbRow href={REPO_LINKS.statusDoc}>
          Architecture and implementation status
        </XmbRow>
      </>
    ),
    ariaLabel: `GET ${op.path}, ${op.auth}`,
  }));
  return <XmbScreen testId="operations" subtitle="Inspection endpoints and local commands. No requests are executed by this website." sections={[{ id: "operations", label: "Inspection endpoints", entries }]} />;
}
