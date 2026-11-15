import { XmbRow } from "@/components/XmbRow";
import { XmbScreen, XmbSectionLabel } from "@/components/XmbScreen";
import { REPO_LINKS } from "@/data/repository";

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
  { name: "Inference History & Identity Audit", detail: "No persistent inference history or tamper-evident identity audit. The optional private administrative event trail records fixed labels and HTTP outcomes, excluding bodies and identities." },
  { name: "Live Key Revocation (Static Keys)", detail: "Rotating YAG_API_KEY or YAG_EXTRA_API_KEYS requires restarting the gateway." },
  { name: "Encrypted Secret Vault", detail: "Secrets are read from standard OS environment variables." },
  { name: "Unauthenticated Socket Rate Limiter", detail: "Rate limits apply per authenticated key; use firewall rules at the network edge." },
  { name: "Independent Security Audit", detail: "Experimental C17 socket server and fuzz corpus have not been externally audited." },
];

export function SecurityPage() {
  return <XmbScreen document={<p>YAG is an inspectable foundation, not a fortress. Credentials remain on the host, while authentication, scopes and request limits establish explicit boundaries. The explanations below separate what the gateway enforces from what an operator must provide.</p>} subtitle="Trust boundaries, credential exposure and operator responsibilities." initialSelected={2} sections={[
    { id: "boundaries", label: "Trust cross-section", entries: STRATA.map((stratum) => ({
      key: stratum.id, title: stratum.title, sub: stratum.zone, value: "Enforced boundary",
      description: stratum.credentialHeld,
      panel: <><XmbSectionLabel>Credentials at this layer</XmbSectionLabel><p>{stratum.credentialHeld}</p>
        <XmbSectionLabel>What YAG enforces</XmbSectionLabel><ul>{stratum.enforced.map((text) => <li key={text}>{text}</li>)}</ul>
        <XmbSectionLabel>Residual risk</XmbSectionLabel><p>{stratum.residualRisk}</p>
        <XmbRow href={REPO_LINKS.security}>Repository threat model</XmbRow></>,
    })) },
    { id: "managed", label: "Managed clients and private administration", entries: [
      { key: "managed-keys", title: "Managed keys can be revoked at runtime", description: "With a private client store, the primary administrator can issue, disable and revoke managed credentials without restarting. Static environment keys still require restart-based rotation. The total extra-key capacity remains bounded." },
      { key: "admin-access", title: "Administrative endpoints stay local", description: "The primary key is required for /api/admin/*, and the LAN Caddy proxy blocks those routes. Provider credentials are host-side aliases; raw upstream secrets are not accepted from the browser." },
      { key: "audit", title: "Optional administrative event trail", panel: <><p>YAG_ADMIN_AUDIT_FILE enables a validated private JSONL file with fixed route/method labels, time and HTTP status. It omits prompt bodies, credentials, IP addresses and client identities.</p><p>This is not tamper-evident auditing or a history of inference requests.</p><XmbRow to="/source?file=admin-audit">Read the audit implementation</XmbRow></> },
    ] },
    { id: "absent", label: "Absent controls", entries: ABSENT_CONTROLS.map((item) => ({
      key: item.name, title: item.name, value: "Not implemented", description: item.detail, panel: <p>{item.detail}</p>,
    })), panel: <p>Wi-Fi membership is not authentication. Plain HTTP exposes keys and traffic. Terminate TLS at a trusted reverse proxy and firewall the host.</p> },
  ]} />;
}
