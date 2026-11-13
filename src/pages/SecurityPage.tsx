import { useState } from "react";
import { Container, PageMasthead, StatusBadge } from "@/components/Primitives";
import { REPO_LINKS } from "@/data/repository";
import { RouteLink } from "@/router/RouterContext";
import { cn } from "@/utils/cn";

interface TrustStratum {
  id: string;
  layer: string;
  title: string;
  zone: "Untrusted / Client Edge" | "Network Transit" | "YAG Host Boundary" | "Backend Zone";
  credentialHeld: string;
  enforced: string[];
  residualRisk: string;
}

const STRATA: TrustStratum[] = [
  {
    id: "client",
    layer: "STRATUM 01",
    title: "Client Applications & Browser Console",
    zone: "Untrusted / Client Edge",
    credentialHeld: "YAG gateway key only (never upstream credentials)",
    enforced: [
      "Console stores gateway key in sessionStorage for the current tab only",
      "Console assets served with Content-Security-Policy: default-src 'self'; connect-src 'self'",
      "Console asset resolver uses openat(..., O_NOFOLLOW) per path component to reject symlink escapes",
    ],
    residualRisk:
      "Any holder of a gateway key can spend inference within that key's scope and rate window until the host is restarted with a rotated secret.",
  },
  {
    id: "network",
    layer: "STRATUM 02",
    title: "Network Transport & Reverse Proxy",
    zone: "Network Transit",
    credentialHeld: "TLS certificate & private CA root (when external proxy is configured)",
    enforced: [
      "Binds 127.0.0.1 loopback by default",
      "Prints explicit stderr WARNING if bound to non-loopback (e.g., 0.0.0.0 or LAN IP)",
      "Optional Colibri LAN Compose stack publishes only a Caddy TLS proxy using a generated private CA",
    ],
    residualRisk:
      "YAG implements NO native TLS server and NO CORS configuration. Plain HTTP on a shared network exposes keys and prompts in cleartext.",
  },
  {
    id: "framing",
    layer: "STRATUM 03",
    title: "HTTP/1.x Framing & Pre-Body Admission",
    zone: "YAG Host Boundary",
    credentialHeld: "In-memory yag_config key table",
    enforced: [
      "MAX_CONNECTIONS = 32 concurrent workers (503 on saturation)",
      "MAX_HEADER = 16 KiB within monotonic YAG_HEADER_DEADLINE_SECONDS (default 10 s)",
      "YAG_MAX_BODY_BYTES = 1 MiB default within monotonic YAG_BODY_DEADLINE_SECONDS (default 30 s)",
      "Rejects control bytes in headers, duplicate Host, chunked Transfer-Encoding, and competing Auth headers",
      "Authenticates headers BEFORE allocating request-body memory or sending 100 Continue",
    ],
    residualRisk:
      "No unauthenticated per-IP connection rate limiting exists at the raw socket layer, and the custom HTTP parser has not undergone an independent security audit.",
  },
  {
    id: "scopes",
    layer: "STRATUM 04",
    title: "Constant-Time Key Check, Scopes & Rate Windows",
    zone: "YAG Host Boundary",
    credentialHeld: "Primary key + ≤ 16 positional extra keys",
    enforced: [
      "Length-masked bitwise XOR key_equal() comparison; keys must be ≥ 16 chars without newlines",
      "Duplicate extra keys rejected at startup so scopes cannot collide ambiguously",
      "Positional scopes: all, inference, models, monitor, or inference+models",
      "Fixed 60-second rate_permit() window returning 429 with Retry-After seconds remaining",
    ],
    residualRisk:
      "Extra keys are not user accounts: there is no cryptographic per-key audit log, and revoking a static env key requires restarting the process.",
  },
  {
    id: "memory",
    layer: "STRATUM 05",
    title: "Host Process Environment & Ephemeral Memory",
    zone: "YAG Host Boundary",
    credentialHeld: "YAG_UPSTREAM_KEY + route key_env secrets in process memory",
    enforced: [
      "Route secrets referenced indirectly by env var name (key_env), never inline in JSON",
      "GET /api/routes and /api/clients never serialize URLs, secrets, IPs, or prompt text",
      "Token usage observer caps buffering at 128 KiB and frees buffer immediately after each request",
      "Opt-in diagnostic traces log allowlisted protocol field categories only — never prompt contents",
    ],
    residualRisk:
      "Secrets reside in OS environment variables and process memory, which privileged local users may inspect.",
  },
  {
    id: "upstream",
    layer: "STRATUM 06",
    title: "Upstream Inference Servers",
    zone: "Backend Zone",
    credentialHeld: "Backend-specific Bearer token attached on outbound libcurl call",
    enforced: [
      "CURLOPT_FOLLOWLOCATION = 0 (upstream HTTP redirects are disabled)",
      "10 s connect timeout and bounded total timeout (default 120 s)",
      "100 ms curl_multi_poll checks client socket EOF to abort abandoned upstream generations",
      "SIGINT/SIGTERM drains active worker transfers cleanly before global cleanup",
    ],
    residualRisk:
      "YAG trusts the configured upstream base URL and relays Chat Completions response bodies and status codes verbatim.",
  },
];

const ABSENT_CONTROLS = [
  { name: "Native TLS Server", detail: "Plain HTTP listener only. Terminate TLS at a trusted reverse proxy (e.g. Caddy/Nginx)." },
  { name: "CORS Configuration", detail: "No Access-Control-Allow-Origin headers or preflight policy engine." },
  { name: "Audit Logging & Request History", detail: "Zero persistent logs of who asked what or when; counters are in-memory only." },
  { name: "Live Key Revocation (Static Keys)", detail: "Rotating YAG_API_KEY or YAG_EXTRA_API_KEYS requires restarting the gateway." },
  { name: "Encrypted Secret Vault", detail: "Secrets are read from standard OS environment variables." },
  { name: "Unauthenticated Socket Rate Limiter", detail: "Rate limits apply per authenticated key; use firewall rules at the network edge." },
  { name: "Independent Security Audit", detail: "Experimental C17 socket server and fuzz corpus have not been externally audited." },
];

export function SecurityPage() {
  const [selectedId, setSelectedId] = useState<string>(STRATA[2].id);
  const active = STRATA.find((s) => s.id === selectedId) ?? STRATA[2];

  return (
    <div>
      <PageMasthead
        path="/security"
        eyebrow="Chapter 07 · Trust Boundaries & Threat Model"
        title={
          <>
            A foundation, <em className="text-rust">not a fortress.</em>
          </>
        }
        lede="YAG's README opens with a warning before listing a single feature. Explore the six trust strata below to see exactly where credentials live, what the C17 listener enforces, and which production security controls do not exist."
        aside={
          <div className="border border-rust/55 bg-rust/[0.08] p-4 font-mono text-[11px]">
            <div className="uppercase tracking-[0.15em] text-rust font-semibold">
              ⚠ Do Not Deploy on Untrusted Networks
            </div>
            <p className="mt-2 leading-relaxed text-paper/90">
              Wi-Fi membership is not authentication. Plain HTTP exposes your keys and traffic. Terminate TLS at a
              trusted reverse proxy and firewall the host.
            </p>
          </div>
        }
      />

      {/* INTERACTIVE 6-STRATUM TRUST CROSS-SECTION */}
      <section className="border-b border-line py-6 @lg:py-8">
        <Container>
          <div className="grid border border-line-strong bg-panel @3xl:grid-cols-12">
            {/* Left Stack: 6 Spatial Trust Layers */}
            <div className="border-b border-line @3xl:col-span-5 @3xl:border-b-0 @3xl:border-r">
              <div className="border-b border-line px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.15em] text-faint">
                Trust Cross-Section (Outer Edge → Upstream)
              </div>
              <ol className="divide-y divide-line">
                {STRATA.map((st) => {
                  const selected = st.id === selectedId;
                  return (
                    <li key={st.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(st.id)}
                        className={cn(
                          "w-full px-4 py-3.5 text-left transition-colors cursor-pointer",
                          selected
                            ? "border-l-2 border-l-amber bg-amber/[0.1]"
                            : "border-l-2 border-l-transparent hover:bg-paper/[0.03]",
                        )}
                      >
                        <div className="flex items-center justify-between font-mono text-[10px]">
                          <span className={selected ? "text-amber" : "text-faint"}>{st.layer}</span>
                          <span className="text-faint">{st.zone}</span>
                        </div>
                        <div className="mt-1 text-[14px] font-medium text-paper">{st.title}</div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>

            {/* Right Inspector: Enforced Controls vs Residual Risk */}
            <div className="p-5 @lg:p-7 @3xl:col-span-7 flex flex-col justify-between" aria-live="polite">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10.5px]">
                  <span className="uppercase tracking-[0.15em] text-amber">
                    {active.layer} · {active.zone}
                  </span>
                  <StatusBadge tone="implemented">Enforced Boundary</StatusBadge>
                </div>

                <h2 className="display mt-3 text-2xl text-paper @lg:text-3xl">{active.title}</h2>

                <div className="mt-4 border border-line bg-ink px-3.5 py-2.5 font-mono text-[11px]">
                  <span className="text-faint">CREDENTIAL EXPOSURE AT THIS LAYER: </span>
                  <span className="text-paper">{active.credentialHeld}</span>
                </div>

                <div className="mt-5">
                  <p className="label text-moss">What YAG Enforces Here</p>
                  <ul className="mt-2.5 space-y-2">
                    {active.enforced.map((item) => (
                      <li key={item} className="flex items-baseline gap-2.5 text-[13.5px] leading-relaxed text-paper/90">
                        <span aria-hidden="true" className="font-mono text-moss">✓</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-6 border-t border-line pt-4">
                  <p className="label text-rust">Residual Risk & Operator Responsibility</p>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{active.residualRisk}</p>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 font-mono text-[11px]">
                <a
                  href={REPO_LINKS.security}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-amber hover:underline"
                >
                  Read README Threat Model ↗
                </a>
                <RouteLink to="/source?file=server-auth" className="text-muted hover:text-paper">
                  Inspect server.c Auth Source →
                </RouteLink>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* EXPLICIT DISCLOSURE: WHAT DOES NOT EXIST */}
      <section className="py-6 @lg:py-8">
        <Container>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label text-rust">Explicit Non-Existence Ledger</p>
              <h2 className="display mt-2 text-2xl text-paper @lg:text-3xl">
                Security controls that are not implemented.
              </h2>
            </div>
            <span className="font-mono text-[11px] text-faint">Plan around their absence before exposing a port</span>
          </div>

          <div className="grid gap-px border border-rust/35 bg-line @lg:grid-cols-2 @3xl:grid-cols-3">
            {ABSENT_CONTROLS.map((item) => (
              <div key={item.name} className="bg-ink p-5">
                <div className="flex items-center justify-between font-mono text-[10px] text-rust">
                  <span>NOT IMPLEMENTED</span>
                  <span aria-hidden="true">×</span>
                </div>
                <h3 className="mt-2 text-[15px] font-medium text-paper">{item.name}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{item.detail}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>
    </div>
  );
}
