import { useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { BLOB_URL, REPO_LINKS } from "@/data/repository";
import { XmbList, type XmbListEntry } from "@/xmb/XmbList";

/**
 * The three System Screens, drawn the way the console draws its own
 * Settings: a lede, the console's list (cursor row standing a size larger),
 * a small note. No cards, no pills, no header panel — the wave shows
 * through and monospace appears only where code does.
 */

const SPECIFICATIONS: Array<[string, string]> = [
  ["Project", "YAG - Yet Another Gateway"],
  ["Project version", "0.1.0 (CMake project definition)"],
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
  const [cursor, setCursor] = useState(0);
  const entries: XmbListEntry[] = SPECIFICATIONS.map(([label, value]) => ({
    key: label,
    title: label,
    value,
    ariaLabel: `${label}: ${value}`,
  }));
  return (
    <div className="settings-screen" data-testid="system-info">
      <p className="settings-lede">
        Specifications from the project repository. This website is not attached to a running
        YAG host and displays no live telemetry.
      </p>
      <XmbList
        entries={entries}
        selected={cursor}
        onSelect={setCursor}
        onHighlight={setCursor}
        compact
        focusOnMount
        className="settings-list"
        ariaLabel="System specifications"
      />
      <p className="settings-note">
        Source:{" "}
        <a href={REPO_LINKS.statusDoc} target="_blank" rel="noreferrer noopener">
          Architecture and implementation status
        </a>
      </p>
    </div>
  );
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
];

export function ConfigurationPage() {
  const [cursor, setCursor] = useState(0);
  const entries: XmbListEntry[] = VARIABLES.map((v) => ({
    key: v.name,
    title: v.name,
    value: v.value,
    detail: (
      <span className="xmb-config-detail">
        <span>{v.text}</span>
        <a className="xmb-code-link" href={`${BLOB_URL}/host/src/core/config.c`} target="_blank" rel="noreferrer noopener">
          host/src/core/config.c
        </a>
        <span className="xmb-config-warn">
          Never commit secrets to public files. Plain HTTP on an untrusted network exposes
          gateway keys and request traffic.
        </span>
      </span>
    ),
    ariaLabel: `${v.name}, default ${v.value}`,
  }));
  return (
    <div className="settings-screen" data-testid="configuration" aria-live="polite">
      <p className="settings-lede">
        The native host reads these values from its private environment at startup. This
        reference does not edit a running gateway or collect credentials. Restart the host to
        apply static configuration changes.
      </p>
      <XmbList
        entries={entries}
        selected={cursor}
        onSelect={setCursor}
        onHighlight={setCursor}
        compact
        focusOnMount
        className="settings-list"
        ariaLabel="Startup environment settings"
      />
    </div>
  );
}

const OPERATIONS = [
  { path: "/health", auth: "Public", description: "Process liveness only. It does not certify that a model or upstream is healthy." },
  { path: "/api/status", auth: "Gateway key", description: "Host status and process-level information." },
  { path: "/api/routes", auth: "Gateway key", description: "Configured model IDs, with upstream URLs and credentials omitted." },
  { path: "/api/metrics", auth: "Monitoring permission", description: "In-memory request counters by protocol. Attempts are not successful generations." },
  { path: "/api/clients", auth: "Monitoring permission", description: "Per-key accepted and throttled counts, positional labels and scopes. No prompts or secrets." },
  { path: "/api/providers/status", auth: "Monitoring permission", description: "Passive attempts, failures, reported usage, latency and circuit state per provider." },
  { path: "/api/capabilities", auth: "Gateway key", description: "Gateway protocol and limit support, not live model capability discovery." },
];

export function OperationsPage() {
  const [cursor, setCursor] = useState(0);
  const entries: XmbListEntry[] = OPERATIONS.map((op, i) => ({
    key: op.path,
    title: `GET ${op.path}`,
    sub: op.auth,
    detail: (
      <span className="xmb-config-detail">
        <span>{op.description}</span>
        <CodeBlock
          code={`curl http://127.0.0.1:8080${op.path}${i > 0 ? ' \\\n  -H "Authorization: Bearer $YAG_API_KEY"' : ""}`}
          lang="bash"
          path="Operator command - not executed here"
          showLineNumbers={false}
        />
        <span className="xmb-config-warn">
          Counters are ephemeral and reset on restart. Reported token counts come from upstream
          usage fields, not estimates. A successful /models probe only establishes reachability.
        </span>
        <a className="xmb-code-link" href={REPO_LINKS.statusDoc} target="_blank" rel="noreferrer noopener">
          Architecture and implementation status
        </a>
      </span>
    ),
    ariaLabel: `GET ${op.path}, ${op.auth}`,
  }));
  return (
    <div className="settings-screen" data-testid="operations" aria-live="polite">
      <p className="settings-lede">
        Select an inspection endpoint to see its purpose and a copyable request. This website
        performs no calls to a gateway; all examples are local instructions.
      </p>
      <XmbList
        entries={entries}
        selected={cursor}
        onSelect={setCursor}
        onHighlight={setCursor}
        compact
        focusOnMount
        className="settings-list"
        ariaLabel="Inspection endpoints"
      />
    </div>
  );
}
