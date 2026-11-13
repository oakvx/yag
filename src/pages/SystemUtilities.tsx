import { useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { Container, PageMasthead } from "@/components/Primitives";
import { BLOB_URL, REPO_LINKS } from "@/data/repository";

const SPECIFICATIONS = [
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
  return (
    <div>
      <PageMasthead
        path="/" eyebrow="System information" title="YAG system specifications"
        lede="Specifications from the project repository. This website is not attached to a running YAG host and displays no live telemetry."
      />
      <section className="py-6 @lg:py-8">
        <Container>
          <dl className="divide-y divide-line border-y border-line">
            {SPECIFICATIONS.map(([label, value]) => (
              <div key={label} className="grid gap-1 py-3 @2xl:grid-cols-[220px_1fr] @2xl:gap-6">
                <dt className="text-[13px] text-faint">{label}</dt>
                <dd className="text-[13px] leading-relaxed text-paper">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-[12px] text-muted">Source: <a href={REPO_LINKS.statusDoc} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">Architecture and implementation status</a></p>
        </Container>
      </section>
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
  const [selected, setSelected] = useState(VARIABLES[0].name);
  const active = VARIABLES.find((v) => v.name === selected) ?? VARIABLES[0];
  return (
    <div>
      <PageMasthead
        path="/deploy" eyebrow="Configuration reference" title="Startup environment settings"
        lede="The native host reads these values from its private environment at startup. This reference does not edit a running gateway or collect credentials. Restart the host to apply static configuration changes."
      />
      <section className="py-6 @lg:py-8">
        <Container>
          <div className="grid gap-7 @3xl:grid-cols-12">
            <div className="@3xl:col-span-7">
              <ul className="divide-y divide-line border-y border-line">
                {VARIABLES.map((v) => (
                  <li key={v.name}>
                    <button type="button" aria-pressed={v.name === selected} onClick={() => setSelected(v.name)} className={`grid w-full gap-1 px-3 py-3 text-left @2xl:grid-cols-[1.4fr_1fr] ${v.name === selected ? "bg-white/[0.07] text-paper" : "text-muted hover:bg-white/[0.03]"}`}>
                      <span className="break-all font-mono text-[11px]">{v.name}</span>
                      <span className="text-[12px] @2xl:text-right">{v.value}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="@3xl:col-span-5" aria-live="polite">
              <p className="text-[12px] text-faint">Selected environment variable</p>
              <h2 className="mt-3 break-all font-mono text-[16px] text-paper">{active.name}</h2>
              <p className="mt-2 text-[13px] text-muted">Default: {active.value}</p>
              <p className="mt-4 text-[14px] leading-relaxed text-paper">{active.text}</p>
              <a href={`${BLOB_URL}/host/src/core/config.c`} target="_blank" rel="noreferrer noopener" className="mt-6 inline-block font-mono text-[11px] text-amber underline underline-offset-4">host/src/core/config.c</a>
              <p className="mt-4 text-[12px] leading-relaxed text-faint">Never commit secrets to public files. Plain HTTP on an untrusted network exposes gateway keys and request traffic.</p>
            </div>
          </div>
        </Container>
      </section>
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
  const [index, setIndex] = useState(0);
  const active = OPERATIONS[index];
  return (
    <div>
      <PageMasthead
        path="/deploy" eyebrow="Operations reference" title="Inspect the host. Do not infer model health."
        lede="Select an inspection endpoint to see its purpose and a copyable request. This website performs no calls to a gateway; all examples are local instructions."
      />
      <section className="py-6 @lg:py-8">
        <Container>
          <div className="grid gap-7 @3xl:grid-cols-12">
            <ul className="divide-y divide-line border-y border-line @3xl:col-span-5">
              {OPERATIONS.map((op, i) => (
                <li key={op.path}>
                  <button type="button" aria-pressed={index === i} onClick={() => setIndex(i)} className={`block w-full px-3 py-3 text-left ${index === i ? "bg-white/[0.07] text-paper" : "text-muted hover:bg-white/[0.03]"}`}>
                    <span className="font-mono text-[12px]">GET {op.path}</span>
                    <span className="mt-1 block text-[11px] text-faint">{op.auth}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="@3xl:col-span-7" aria-live="polite">
              <h2 className="font-mono text-[16px] text-paper">GET {active.path}</h2>
              <p className="my-4 text-[14px] leading-relaxed text-muted">{active.description}</p>
              <CodeBlock code={`curl http://127.0.0.1:8080${active.path}${index > 0 ? ' \\\n  -H "Authorization: Bearer $YAG_API_KEY"' : ''}`} lang="bash" path="Operator command - not executed here" showLineNumbers={false} />
              <p className="mt-5 border-l border-line-strong pl-4 text-[12px] leading-relaxed text-faint">Counters are ephemeral and reset on restart. Reported token counts come from upstream usage fields, not estimates. A successful /models probe only establishes reachability.</p>
              <a href={REPO_LINKS.statusDoc} target="_blank" rel="noreferrer noopener" className="mt-5 inline-block text-[12px] text-amber underline underline-offset-4">Architecture and implementation status</a>
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}