# YAG operator controls and telemetry

Use the gateway key via an environment variable. Never place API keys in
public command examples, logs, issue reports or CI workflow inputs.

## Circuit breaker and safe failover

```sh
export YAG_CIRCUIT_THRESHOLD=3
export YAG_CIRCUIT_COOLDOWN_SECONDS=30
export YAG_FALLBACK_TO_DEFAULT=1
```

All three are opt-in (the circuit threshold and fallback are **disabled by
default**). After the configured number of consecutive failures of a routed
provider, YAG rejects new work to that route for the cooldown interval.
When the cooldown ends, one half-open request probes recovery. During
an open circuit, YAG can forward a **new, not-yet-sent** request to the default
provider if fallback is enabled.

After an HTTP 5xx or ambiguous timeout, **YAG never automatically retries the
same generation**. This avoids duplicate model or agent side effects.
A circuit breaker does not perform continuous provider monitoring.

## Observability

```sh
curl -H "Authorization: Bearer $YAG_API_KEY" \
  http://127.0.0.1:8080/api/providers/status
curl -H "Authorization: Bearer $YAG_API_KEY" \
  http://127.0.0.1:8080/api/models/capabilities
```

The first endpoint contains provider attempts, successes, failures, bypasses,
fallbacks, total latency, circuit state and totals of upstream-reported tokens.
Counters reset on every restart, are not attributed to users or prompts,
and **do not estimate missing token usage**. Very large SSE streams may exceed
the bounded observer; this affects only usage accounting, not data forwarding.

The second endpoint lists operator declarations, never inferred model
capabilities. Every entry is explicitly `verified:false`.

## Optional model capability admission guard

Set `YAG_ENFORCE_MODEL_CAPABILITIES=1` to fail early with HTTP 422
when a model has an operator declaration but lacks a requested capability:
function tools, streaming, reasoning or JSON-schema output. With
`YAG_ENFORCE_MODEL_CAPABILITIES=0` (default), model requests behave as
before; only upstream and adapter validations apply.

A declaration is **not an automated model capability test**. Any model
without a declaration remains subject to the backend's own behavior;
the guard does not reject it as unsupported.

## Scoped API keys

Additional static keys can be narrowed to one or more operations. The
positional `YAG_EXTRA_KEY_SCOPES` comma-separated setting aligns with
`YAG_EXTRA_API_KEYS` and supports: `all`, `inference`, `models`,
`monitor`, and `inference+models`. The primary key always has full privileges.

For example:

```sh
export YAG_EXTRA_API_KEYS='LONG_INFERENCE_KEY_VALUE,LONG_MONITOR_KEY_VALUE'
export YAG_EXTRA_KEY_SCOPES='inference+models,monitor'
```

- `inference` permits `POST /v1/chat/completions`, `POST /v1/responses`
  and `POST /v1/messages`.
- `models` permits `GET /v1/models` and `GET /v1/models/{id}`.
  The latter resolves exact IDs from the merged model inventory; unknown IDs
  return 404.
- `monitor` permits read-only `/api/*` inventory, status and metrics.
- Only `all` can call active provider reachability checks.
- Any denied scope returns 403; invalid credentials return 401.
- All API key values must be unique, including the primary key. YAG refuses
  startup if an extra key duplicates another key, preventing ambiguous
  permission selection when scopes differ.
- Rotating or revoking keys requires process restart; these are **not**
  user accounts or an online identity administration API.

## Strict inbound request parsing

YAG accepts only HTTP/1.0 and HTTP/1.1 with exactly one ASCII space
between request-line tokens. It rejects ambiguous whitespace, control bytes
in header values (except horizontal tab), duplicate or empty Host headers,
and conflicting Authorization / X-API-Key credentials. These checks apply
before request routing and do not replace a hardened reverse proxy.
Use standard HTTP clients rather than crafting noncanonical request lines.

## Hard limits

Header deadline defaults to 10 seconds and body deadline to 30 seconds
(`YAG_HEADER_DEADLINE_SECONDS` and `YAG_BODY_DEADLINE_SECONDS`).
When per-key rate limiting is enabled, rejected requests return HTTP 429
with `Retry-After` in seconds (1–60) until the fixed window resets. The
header is computed per key and reveals no credential or quota counters.

A single request body is capped at 1 MiB; only HTTP/1.x with Content-Length
is supported. Limits and POSIX socket code are **not** a security audit.
Use a TLS proxy, firewall, and dedicated access controls for remote use.

For model correctness and CLI interoperability, see
[real-model qualification](../integrations/live-model.md).
