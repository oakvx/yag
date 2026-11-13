import { useEffect, useState } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { Container, PageMasthead, StatusBadge } from "@/components/Primitives";
import { BLOB_URL } from "@/data/repository";
import { RouteLink, useRouter } from "@/router/RouterContext";
import { cn } from "@/utils/cn";

type TraceScenarioId = "chat" | "responses" | "messages" | "routed" | "rejected";

interface StageStep {
  num: string;
  name: string;
  file: string;
  href: string;
  active: boolean;
  haltedHere?: boolean;
  input: string;
  output: string;
  whatHappens: string;
  failureModes: string;
  code: string;
}

interface TraceScenario {
  id: TraceScenarioId;
  label: string;
  requestLine: string;
  badge: string;
  summary: string;
  haltStageIndex?: number;
  stages: StageStep[];
}

const SCENARIOS: TraceScenario[] = [
  {
    id: "chat",
    label: "01 · Chat Passthrough",
    requestLine: "POST /v1/chat/completions (model: llama3.2, stream: true)",
    badge: "Transparent Proxy",
    summary: "Standard OpenAI Chat Completions request forwarded to the default upstream with SSE relayed directly.",
    stages: [
      {
        num: "01",
        name: "Admission",
        file: "host/src/http/server.c",
        href: `${BLOB_URL}/host/src/http/server.c`,
        active: true,
        input: "TCP accept() → raw HTTP/1.x header bytes",
        output: "Parsed method, URI, Content-Length ≤ max_body_bytes",
        whatHappens:
          "Checks active < MAX_CONNECTIONS (32), reads headers within YAG_HEADER_DEADLINE_SECONDS (10 s), rejects control bytes, duplicate Host headers, and chunked Transfer-Encoding.",
        failureModes: "503 if 32 workers active; 408 on header timeout; 413 if Content-Length > max_body_bytes; 411 if POST lacks Content-Length.",
        code: `if (c->active >= MAX_CONNECTIONS) { error(fd, 503, "Connection limit reached"); }
if (transfer_encoding) { error(fd, 400, "Transfer-Encoding is not supported"); goto done; }`,
      },
      {
        num: "02",
        name: "Authentication",
        file: "host/src/http/server.c",
        href: `${BLOB_URL}/host/src/http/server.c`,
        active: true,
        input: "Authorization: Bearer <gateway_key>",
        output: "key_index (0 = primary, 1..16 = extra) + inference scope verified",
        whatHappens:
          "Constant-time key_equal() verifies Bearer token BEFORE allocating or buffering the POST body. Checks scope bitmask and 60-second rate_permit() window.",
        failureModes: "401 Unauthorized; 403 Insufficient API key scope; 429 Too Many Requests with Retry-After.",
        code: `key_index = auth ? authenticated_key(c, auth) : -1;
if (key_index < 0) { error(fd, 401, "Unauthorized"); goto done; }
if (!(scope & required)) { error(fd, 403, "Insufficient API key scope"); goto done; }`,
      },
      {
        num: "03",
        name: "Protocol Handling",
        file: "host/src/http/server.c",
        href: `${BLOB_URL}/host/src/http/server.c`,
        active: true,
        input: "JSON body read within YAG_BODY_DEADLINE_SECONDS (30 s)",
        output: "Unmodified JSON body + extracted top-level model string",
        whatHappens:
          "Parses JSON with yyjson to verify only that root is an object with a model string and messages[] array. Optional declared-capability guard runs if YAG_ENFORCE_MODEL_CAPABILITIES=1.",
        failureModes: "408 body timeout; 400 if model/messages missing; 422 if operator-declared capability policy rejects requested features.",
        code: `if (!yyjson_is_obj(root) || !yyjson_is_str(yyjson_obj_get(root, "model")) ||
    !yyjson_is_arr(yyjson_obj_get(root, "messages")))
  error(fd, 400, "Expected JSON object with model string and messages array");`,
      },
      {
        num: "04",
        name: "Route Selection",
        file: "host/src/core/config.c",
        href: `${BLOB_URL}/host/src/core/config.c`,
        active: true,
        input: 'model = "llama3.2"',
        output: "target = default upstream (YAG_UPSTREAM_URL)",
        whatHappens:
          'config_for_model() scans c->routes[0..route_count-1]. When "llama3.2" is not in YAG_MODEL_ROUTES, it returns the default upstream config (or chooses a healthy replica if YAG_UPSTREAM_POOL is set).',
        failureModes: "None at lookup; static lookup makes zero network calls.",
        code: `const yag_config *target = config_for_model(c, model, &selected);
/* Unmatched model returns default config c unchanged */`,
      },
      {
        num: "05",
        name: "Upstream Forwarding",
        file: "host/src/inference/openai.c",
        href: `${BLOB_URL}/host/src/inference/openai.c`,
        active: true,
        input: "POST <YAG_UPSTREAM_URL>/chat/completions + host YAG_UPSTREAM_KEY",
        output: "Upstream HTTP status + response byte stream",
        whatHappens:
          "Attaches host-only Authorization header if YAG_UPSTREAM_KEY is set, disables redirects, and polls curl_multi_poll() every 100 ms while checking peer_closed(fd) for client cancellation.",
        failureModes: "504 Gateway Timeout if total timeout exceeded before headers; 502 Bad Gateway if connection fails.",
        code: `mc = curl_multi_poll(multi, NULL, 0, 100, &activity);
if (cancel_fd >= 0 && peer_closed(cancel_fd)) {
  result = (int)CURLE_ABORTED_BY_CALLBACK; break;
}`,
      },
      {
        num: "06",
        name: "Response Relay",
        file: "host/src/inference/openai.c",
        href: `${BLOB_URL}/host/src/inference/openai.c`,
        active: true,
        input: "text/event-stream chunks from upstream",
        output: "Verbatim HTTP status + SSE frames written to client socket",
        whatHappens:
          "Writes upstream status code and Content-Type on first chunk, then streams bytes directly to the client socket with MSG_NOSIGNAL.",
        failureModes: "If upstream dies mid-stream after headers are sent, HTTP status cannot change retroactively — connection closes and client must detect incomplete SSE.",
        code: `static size_t proxy_write(void *ctx, long status, const char *type, const char *data, size_t n) {
  transfer *t = ctx; t->status = status;
  snprintf(t->content_type, sizeof t->content_type, "%s", type);
  start(t);
  return send_all(t->fd, data, n) == 0 ? n : 0;
}`,
      },
      {
        num: "07",
        name: "Monitoring",
        file: "host/src/inference/openai.c",
        href: `${BLOB_URL}/host/src/inference/openai.c`,
        active: true,
        input: "Transfer completion code + bounded 128 KiB usage observer",
        output: "Updated in-memory counters; zero prompt retention",
        whatHappens:
          "Increments chat_requests, attempts, latency_ms, and reported prompt/completion tokens (if response ≤ 128 KiB). Ephemeral capture buffer is freed immediately.",
        failureModes: "Streams > 128 KiB disable token observation rather than estimating tokens.",
        code: `if (len > MAX_USAGE_CAPTURE || cap->size > MAX_USAGE_CAPTURE - len) {
  cap->disabled = 1; free(cap->bytes); cap->bytes = NULL;
}`,
      },
    ],
  },
  {
    id: "responses",
    label: "02 · Responses Adapter",
    requestLine: "POST /v1/responses (input, instructions, namespace tools, store: false)",
    badge: "Stateless Translation",
    summary: "Stateless OpenAI Responses subset translated to Chat Completions and re-emitted as numbered Responses SSE events.",
    stages: [
      {
        num: "01",
        name: "Admission",
        file: "host/src/http/server.c",
        href: `${BLOB_URL}/host/src/http/server.c`,
        active: true,
        input: "POST /v1/responses · Content-Length ≤ 1 MiB",
        output: "Admitted worker socket",
        whatHappens: "Enforces identical socket caps (32 conns, 16 KiB headers, 1 MiB incoming body, monotonic deadlines).",
        failureModes: "400/408/413/503 on framing or cap violations.",
        code: `else if (!strcmp(uri, "/v1/responses") && !strcmp(method, "POST")) {
  increment(c, &c->responses_requests);`,
      },
      {
        num: "02",
        name: "Authentication",
        file: "host/src/http/server.c",
        href: `${BLOB_URL}/host/src/http/server.c`,
        active: true,
        input: "Authorization: Bearer <gateway_key>",
        output: "Verified key with inference scope",
        whatHappens: "Requires Bearer header (X-API-Key is not accepted on /v1/responses) and checks rate limit window.",
        failureModes: "401 if missing/invalid or using X-API-Key; 403 if monitor/models-only key.",
        code: `key_index = auth ? authenticated_key(c, auth) : -1;`,
      },
      {
        num: "03",
        name: "Protocol Handling",
        file: "host/src/protocols/openai_responses/request.c",
        href: `${BLOB_URL}/host/src/protocols/openai_responses/request.c`,
        active: true,
        input: "Responses JSON (instructions, input[], tools[], max_output_tokens)",
        output: "Synthesized Chat Completions JSON payload",
        whatHappens:
          "Validates allowlisted top-level keys, enforces store=false, turns instructions into a system message, maps max_output_tokens → max_tokens, and flattens namespace tools to namespace__fn.",
        failureModes: "400 on store:true, previous_response_id, web_search, multimodal inputs, or unknown fields.",
        code: `if (inst && !yyjson_is_null(inst) && !add_message(d, messages, "system", inst)) goto done;
/* Namespace tool flattened: snprintf(flat, sizeof flat, "%s__%s", ns, name) */`,
      },
      {
        num: "04",
        name: "Route Selection",
        file: "host/src/core/config.c",
        href: `${BLOB_URL}/host/src/core/config.c`,
        active: true,
        input: "Extracted model ID from Responses payload",
        output: "Matched route or default upstream",
        whatHappens: "Translated Responses calls use the exact same config_for_model() table as native Chat calls.",
        failureModes: "Static route selection does not verify upstream tool-calling support.",
        code: `const yag_config *target = config_for_model(c, model, &selected);`,
      },
      {
        num: "05",
        name: "Upstream Forwarding",
        file: "host/src/inference/openai.c",
        href: `${BLOB_URL}/host/src/inference/openai.c`,
        active: true,
        input: "POST <upstream>/chat/completions with translated JSON",
        output: "Upstream Chat JSON or Chat SSE stream (≤ 4 MiB)",
        whatHappens: "Sends translated Chat request via libcurl with 100 ms client-EOF polling and 4 MiB upstream response cap.",
        failureModes: "Upstream 4xx/5xx prior to streaming are forwarded verbatim; 502/504 on transport failure.",
        code: `upstream_for_model(c, model, "/chat/completions", r.chat_json, strlen(r.chat_json), ...);`,
      },
      {
        num: "06",
        name: "Response Relay",
        file: "host/src/protocols/openai_responses/response.c",
        href: `${BLOB_URL}/host/src/protocols/openai_responses/response.c`,
        active: true,
        input: "Chat Completions chunks / tool_calls",
        output: "response.created → response.output_text.delta → response.completed",
        whatHappens:
          "Consumes Chat SSE incrementally, assigns sequence_number 0..N, restores flattened namespace__fn calls into {namespace, name}, and emits terminal events.",
        failureModes: "Emits SSE error event if stream truncates, exceeds 64 output items, or alters function call ID mid-stream.",
        code: `/* Emits sequenced events:
 * response.created, response.in_progress, response.output_item.added,
 * response.output_text.delta, ..., response.completed */`,
      },
      {
        num: "07",
        name: "Monitoring",
        file: "host/src/http/server.c",
        href: `${BLOB_URL}/host/src/http/server.c`,
        active: true,
        input: "Completed / failed Responses attempt",
        output: "responses_requests++ and provider latency stats",
        whatHappens: "Updates in-memory responses_requests and provider attempt counters; frees input_doc and chat_json.",
        failureModes: "All counters reset on process restart.",
        code: `void responses_request_free(response_request *r) {
  free(r->chat_json); yyjson_doc_free(r->input_doc);
}`,
      },
    ],
  },
  {
    id: "messages",
    label: "03 · Anthropic Messages",
    requestLine: "POST /v1/messages (x-api-key, system, tool_use / tool_result, stream: true)",
    badge: "Bounded Subset",
    summary: "Anthropic Messages request authenticated via X-API-Key, translated to Chat, and streamed back as Anthropic SSE.",
    stages: [
      {
        num: "01",
        name: "Admission",
        file: "host/src/http/server.c",
        href: `${BLOB_URL}/host/src/http/server.c`,
        active: true,
        input: "POST /v1/messages (optional ?beta=true query normalized)",
        output: "Admitted Messages request",
        whatHappens: "Accepts /v1/messages (and strips known ?beta=true query while rejecting unknown query parameters).",
        failureModes: "400 on unknown query parameters; 501 on /v1/messages/count_tokens.",
        code: `else if (!strcmp(uri, "/v1/messages/count_tokens"))
  error(fd, 501, "Anthropic token counting not implemented");`,
      },
      {
        num: "02",
        name: "Authentication",
        file: "host/src/http/server.c",
        href: `${BLOB_URL}/host/src/http/server.c`,
        active: true,
        input: "x-api-key: <YAG_API_KEY> (or Authorization: Bearer)",
        output: "Verified gateway key index",
        whatHappens: "Allows native Anthropic X-API-Key carrying the YAG gateway secret (rejects if both Authorization and X-API-Key are sent).",
        failureModes: "400 if both headers present; 401 if invalid key.",
        code: `key_index = auth ? authenticated_key(c, auth)
                 : (is_messages && native_key ? authenticated_raw_key(c, native_key) : -1);`,
      },
      {
        num: "03",
        name: "Protocol Handling",
        file: "host/src/protocols/anthropic/messages.c",
        href: `${BLOB_URL}/host/src/protocols/anthropic/messages.c`,
        active: true,
        input: "Anthropic system blocks, messages[], tools[], thinking{}",
        output: "Translated Chat Completions JSON",
        whatHappens:
          "Joins system text blocks (validating ephemeral cache_control hints without caching), converts tool_result/tool_use blocks, and maps thinking enabled/adaptive → reasoning_effort high/medium.",
        failureModes: "400 generic invalid_request_error (never echoing prompt text) on images, documents, or unsupported edits.",
        code: `if (!translated) {
  diagnostic_shape(root);
  anthropic_error(fd, 400);
  yyjson_doc_free(request); return;
}`,
      },
      {
        num: "04",
        name: "Route Selection",
        file: "host/src/core/config.c",
        href: `${BLOB_URL}/host/src/core/config.c`,
        active: true,
        input: "Anthropic model field",
        output: "Exact route match or default upstream",
        whatHappens: "Looks up the requested model string in YAG_MODEL_ROUTES or falls back to YAG_UPSTREAM_URL.",
        failureModes: "Upstream model must actually support Chat Completions.",
        code: `const char *model = yyjson_get_str(yyjson_obj_get(root, "model"));`,
      },
      {
        num: "05",
        name: "Upstream Forwarding",
        file: "host/src/inference/openai.c",
        href: `${BLOB_URL}/host/src/inference/openai.c`,
        active: true,
        input: "POST <upstream>/chat/completions",
        output: "Chat JSON (≤ 4 MiB) or Chat SSE stream",
        whatHappens: "Dispatches to anthropic_stream_handle() when stream:true, or collects non-streaming Chat JSON up to 4 MiB.",
        failureModes: "429 mapped to Anthropic rate-limit error; timeout mapped to 504; invalid upstream shape mapped to 502.",
        code: `if (requested_stream && yyjson_get_bool(requested_stream)) {
  anthropic_stream_handle(fd, cfg, model, json);
}`,
      },
      {
        num: "06",
        name: "Response Relay",
        file: "host/src/protocols/anthropic/stream.c",
        href: `${BLOB_URL}/host/src/protocols/anthropic/stream.c`,
        active: true,
        input: "Chat SSE deltas (content + tool_calls)",
        output: "message_start → content_block_delta → message_stop",
        whatHappens: "Emits Anthropic-formatted event/data SSE pairs for text and input_json_delta tool arguments.",
        failureModes: "Non-streaming responses require valid upstream prompt_tokens and completion_tokens or return 502.",
        code: `/* SSE frame sequence verified in tests/anthropic.py:
 * message_start -> content_block_start -> content_block_delta
 * -> content_block_stop -> message_delta -> message_stop */`,
      },
      {
        num: "07",
        name: "Monitoring",
        file: "host/src/http/server.c",
        href: `${BLOB_URL}/host/src/http/server.c`,
        active: true,
        input: "Completed Messages exchange",
        output: "anthropic_requests++ · optional allowlisted shape trace",
        whatHappens: "If YAG_TRACE_ANTHROPIC_SHAPE=1 and input was rejected, logs only allowlisted block category names — never prompt text.",
        failureModes: "Diagnostic trace is local stderr only and off by default.",
        code: `if (!trace || !*trace || !strcmp(trace, "0")) return;
/* Logs block types (text, tool_use, image...) — never prompt strings */`,
      },
    ],
  },
  {
    id: "routed",
    label: "04 · Routed Model Match",
    requestLine: 'POST /v1/chat/completions (model: "qwen2.5-coder")',
    badge: "Exact-Model Dispatch",
    summary: "Request whose model string matches an entry in YAG_MODEL_ROUTES, switching destination URL and upstream secret.",
    stages: [
      {
        num: "01",
        name: "Admission",
        file: "host/src/http/server.c",
        href: `${BLOB_URL}/host/src/http/server.c`,
        active: true,
        input: "POST /v1/chat/completions",
        output: "Framed HTTP/1.x headers",
        whatHappens: "Standard bounded socket admission on :8080.",
        failureModes: "Same 32-connection and 16 KiB header caps.",
        code: `int n = read_until_deadline(fd, buf + used, ..., c->header_deadline_seconds);`,
      },
      {
        num: "02",
        name: "Authentication",
        file: "host/src/http/server.c",
        href: `${BLOB_URL}/host/src/http/server.c`,
        active: true,
        input: "Client's YAG gateway key",
        output: "Authorized client session",
        whatHappens: "Client authenticates with YAG_API_KEY — the client does not know or possess the second backend's secret.",
        failureModes: "401 / 403 / 429 on auth or rate-window failure.",
        code: `/* Client sends YAG_API_KEY; route secret remains in host env */`,
      },
      {
        num: "03",
        name: "Protocol Handling",
        file: "host/src/http/server.c",
        href: `${BLOB_URL}/host/src/http/server.c`,
        active: true,
        input: 'Body with "model": "qwen2.5-coder"',
        output: 'Extracted model string "qwen2.5-coder"',
        whatHappens: "Extracts top-level model identifier without altering request fields.",
        failureModes: "400 on malformed JSON.",
        code: `upstream_request(fd, c, "/chat/completions", body, length,
                 yyjson_get_str(yyjson_obj_get(root, "model")));`,
      },
      {
        num: "04",
        name: "Route Selection",
        file: "host/src/core/config.c",
        href: `${BLOB_URL}/host/src/core/config.c`,
        active: true,
        input: 'model = "qwen2.5-coder"',
        output: "selected.upstream = routes[0].url, selected.upstream_key = routes[0].key",
        whatHappens:
          "strcmp() matches routes[0].model! Checks route_admitted() circuit breaker state and constructs per-request config pointing at :9000/v1.",
        failureModes: "If circuit breaker is open and YAG_FALLBACK_TO_DEFAULT=0, rejects immediately with 502.",
        code: `if (strcmp(model, c->routes[i].model)) continue;
selected->upstream = c->routes[i].url;
selected->upstream_key = c->routes[i].key;`,
      },
      {
        num: "05",
        name: "Upstream Forwarding",
        file: "host/src/inference/openai.c",
        href: `${BLOB_URL}/host/src/inference/openai.c`,
        active: true,
        input: "POST http://127.0.0.1:9000/v1/chat/completions + $YAG_ROUTE_KEY",
        output: "Upstream response from routed backend",
        whatHappens:
          "Calls the routed backend with its dedicated Bearer secret. Only if TCP/DNS setup fails before any HTTP status AND YAG_FALLBACK_TO_DEFAULT=1 will it fall through to default.",
        failureModes: "HTTP 500 or timeout from the routed backend is NEVER replayed to default.",
        code: `if (c->fallback_to_default && target != c && (!status || !*status) &&
    (rc == CURLE_COULDNT_CONNECT || rc == CURLE_COULDNT_RESOLVE_HOST))`,
      },
      {
        num: "06",
        name: "Response Relay",
        file: "host/src/inference/openai.c",
        href: `${BLOB_URL}/host/src/inference/openai.c`,
        active: true,
        input: "Routed backend HTTP response",
        output: "Relayed bytes to client",
        whatHappens: "Streams response back transparently; client never sees the routed backend's URL or secret.",
        failureModes: "Upstream status forwarded verbatim.",
        code: `return send_all(t->fd, data, n) == 0 ? n : 0;`,
      },
      {
        num: "07",
        name: "Monitoring",
        file: "host/src/inference/openai.c",
        href: `${BLOB_URL}/host/src/inference/openai.c`,
        active: true,
        input: "Attempt outcome & latency",
        output: "routes[0].stats updated (attempts, consecutive_failures, open_until)",
        whatHappens: "Records outcome on routes[0].stats; trips circuit breaker if consecutive_failures >= circuit_threshold.",
        failureModes: "Visible via GET /api/providers/status.",
        code: `if (cfg->circuit_threshold && stats->consecutive_failures >= cfg->circuit_threshold)
  stats->open_until = time(NULL) + (time_t)cfg->circuit_cooldown_seconds;`,
      },
    ],
  },
  {
    id: "rejected",
    label: "05 · Pre-Body Short-Circuit",
    requestLine: "POST /v1/chat/completions (invalid key or 429 rate-limit exceeded)",
    badge: "Halts at Stage 02",
    summary: "Demonstrates defensive short-circuiting: unauthenticated or rate-limited POSTs are rejected before body allocation.",
    haltStageIndex: 1,
    stages: [
      {
        num: "01",
        name: "Admission",
        file: "host/src/http/server.c",
        href: `${BLOB_URL}/host/src/http/server.c`,
        active: true,
        input: "POST /v1/chat/completions · Content-Length: 900000",
        output: "Headers parsed; body NOT yet buffered",
        whatHappens: "Reads only the HTTP header block (≤ 16 KiB) and pauses before allocating the 900 KiB body buffer.",
        failureModes: "413 if Content-Length > max_body_bytes.",
        code: `/* Headers parsed; body buffer is not allocated yet */`,
      },
      {
        num: "02",
        name: "Authentication",
        file: "host/src/http/server.c",
        href: `${BLOB_URL}/host/src/http/server.c`,
        active: true,
        haltedHere: true,
        input: "Invalid Bearer token OR exhausted 60s key quota",
        output: "HTTP 401 Unauthorized OR HTTP 429 Retry-After — socket closed",
        whatHappens:
          "Authentication or rate_permit() rejects the request immediately. 100 Continue is never sent, the 900 KiB body is never read, and no upstream socket is opened.",
        failureModes: "Intentional fail-fast termination.",
        code: `if (key_index < 0) { error(fd, 401, "Unauthorized"); goto done; }
if (!rate_permit(c, key_index, &retry_after)) {
  rate_limited(fd, retry_after); goto done;
}`,
      },
      {
        num: "03",
        name: "Protocol Handling",
        file: "host/src/http/server.c",
        href: `${BLOB_URL}/host/src/http/server.c`,
        active: false,
        input: "Unreached",
        output: "Skipped",
        whatHappens: "Bypassed — request terminated at Stage 02 before JSON parsing.",
        failureModes: "N/A",
        code: `/* Unreached: worker jumped to done: and closed socket */`,
      },
      {
        num: "04",
        name: "Route Selection",
        file: "host/src/core/config.c",
        href: `${BLOB_URL}/host/src/core/config.c`,
        active: false,
        input: "Unreached",
        output: "Skipped",
        whatHappens: "Bypassed — route table never consulted.",
        failureModes: "N/A",
        code: `/* Unreached */`,
      },
      {
        num: "05",
        name: "Upstream Forwarding",
        file: "host/src/inference/openai.c",
        href: `${BLOB_URL}/host/src/inference/openai.c`,
        active: false,
        input: "Unreached",
        output: "Skipped",
        whatHappens: "Bypassed — inference backend completely shielded from rejected traffic.",
        failureModes: "N/A",
        code: `/* Unreached — zero upstream load */`,
      },
      {
        num: "06",
        name: "Response Relay",
        file: "host/src/http/server.c",
        href: `${BLOB_URL}/host/src/http/server.c`,
        active: false,
        input: "Unreached",
        output: "Skipped",
        whatHappens: "401/429 JSON error was already written directly at Stage 02.",
        failureModes: "N/A",
        code: `/* Connection closed cleanly */`,
      },
      {
        num: "07",
        name: "Monitoring",
        file: "host/src/http/server.c",
        href: `${BLOB_URL}/host/src/http/server.c`,
        active: false,
        input: "Rate-limit counter (if 429)",
        output: "key_rate_limited_requests[key_index]++",
        whatHappens: "If rejected by rate limit, increments throttled counter for monitor visibility; unauthenticated 401s increment no key slot.",
        failureModes: "Note: there is no unauthenticated IP-level connection rate limiter.",
        code: `if (permit) c->key_accepted_requests[key_index]++;
else c->key_rate_limited_requests[key_index]++;`,
      },
    ],
  },
];

export function LifecyclePage() {
  const { query } = useRouter();
  const [scenarioId, setScenarioId] = useState<TraceScenarioId>("chat");
  const [stageIdx, setStageIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  const maxReachable = scenario.haltStageIndex ?? scenario.stages.length - 1;
  const stage = scenario.stages[stageIdx] ?? scenario.stages[0];

  useEffect(() => {
    if (query.autorun === "1") {
      setStageIdx(0);
      setPlaying(true);
    }
  }, [query.autorun]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      setStageIdx((prev) => {
        if (prev >= maxReachable) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 950);
    return () => window.clearTimeout(timer);
  }, [maxReachable, playing, stageIdx]);

  const selectScenario = (id: TraceScenarioId) => {
    setPlaying(false);
    setScenarioId(id);
    setStageIdx(0);
  };

  return (
    <div>
      <PageMasthead
        path="/lifecycle"
        eyebrow="Chapter 03 · Deterministic Request Tracer"
        title={
          <>
            Seven stages from <code className="font-mono text-[0.82em] text-amber">accept()</code> to socket close.
          </>
        }
        lede="Select a request shape and step the signal through YAG's seven execution stages — or run the deterministic trace to watch how admission, pre-body header authentication, adaptation, and upstream polling interact."
        aside={
          <div className="border border-line-strong bg-panel p-4 font-mono text-[11px]">
            <StatusBadge tone="mock">Educational Simulation</StatusBadge>
            <p className="mt-2.5 leading-relaxed text-muted">
              This tracer steps through deterministic state transitions derived directly from{" "}
              <span className="text-paper">host/src/</span>. It performs zero network calls.
            </p>
          </div>
        }
      />

      <section className="py-6 @lg:py-8">
        <Container>
          {/* Scenario Selector + Playback Controls */}
          <div className="border border-line-strong bg-panel">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div role="tablist" aria-label="Request shape scenarios" className="flex flex-wrap gap-1.5">
                {SCENARIOS.map((sc) => {
                  const selected = sc.id === scenarioId;
                  return (
                    <button
                      key={sc.id}
                      role="tab"
                      aria-selected={selected}
                      onClick={() => selectScenario(sc.id)}
                      className={cn(
                        "border px-3 py-1.5 font-mono text-[10.5px] transition-colors cursor-pointer",
                        selected
                          ? "border-amber bg-amber/15 text-paper"
                          : "border-line text-faint hover:text-paper",
                      )}
                    >
                      {sc.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    setStageIdx((i) => Math.max(0, i - 1));
                  }}
                  disabled={stageIdx === 0}
                  className="border border-line px-2.5 py-1 font-mono text-[10.5px] text-muted hover:border-paper hover:text-paper disabled:opacity-35 cursor-pointer"
                >
                  ◀ Prev
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (playing) {
                      setPlaying(false);
                    } else {
                      if (stageIdx >= maxReachable) setStageIdx(0);
                      setPlaying(true);
                    }
                  }}
                  className="border border-amber bg-amber/15 px-3.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.13em] text-paper hover:bg-amber/25 cursor-pointer"
                >
                  {playing ? "❚❚ Pause Trace" : "▶ Run Signal Trace"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    setStageIdx((i) => Math.min(scenario.stages.length - 1, i + 1));
                  }}
                  disabled={stageIdx === scenario.stages.length - 1}
                  className="border border-line px-2.5 py-1 font-mono text-[10.5px] text-muted hover:border-paper hover:text-paper disabled:opacity-35 cursor-pointer"
                >
                  Next ▶
                </button>
              </div>
            </div>

            {/* Active Scenario Wire Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-ink/70 px-4 py-2.5 font-mono text-[11px]">
              <div>
                <span className="text-amber">WIRE:</span> <span className="text-paper">{scenario.requestLine}</span>
              </div>
              <span className="text-faint">{scenario.summary}</span>
            </div>

            {/* 7-Stage Spatial Signal Bus */}
            <div className="overflow-x-auto bg-[rgba(3,12,34,0.55)] px-4 py-6 @lg:px-6">
              <ol className="grid min-w-[780px] grid-cols-7 gap-2">
                {scenario.stages.map((st, idx) => {
                  const isCurrent = idx === stageIdx;
                  const isPassed = idx < stageIdx && st.active;
                  const isUnreached = !st.active;

                  return (
                    <li key={st.num} className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          setPlaying(false);
                          setStageIdx(idx);
                        }}
                        className={cn(
                          "w-full border p-3 text-left transition-all cursor-pointer",
                          isCurrent && st.haltedHere
                            ? "border-rust bg-rust/15"
                            : isCurrent
                              ? "border-amber bg-amber/[0.12]"
                              : isPassed
                                ? "border-moss/50 bg-moss/[0.06]"
                                : isUnreached
                                  ? "hatch-rust border-line opacity-50"
                                  : "border-line bg-panel hover:border-line-strong",
                        )}
                      >
                        <div className="flex items-center justify-between font-mono text-[10px]">
                          <span
                            className={cn(
                              isCurrent && st.haltedHere
                                ? "text-rust"
                                : isCurrent
                                  ? "text-amber"
                                  : isPassed
                                    ? "text-moss"
                                    : "text-faint",
                            )}
                          >
                            {st.num}
                          </span>
                          <span
                            className={cn(
                              "h-2 w-2 rounded-full",
                              isCurrent && st.haltedHere
                                ? "bg-rust"
                                : isCurrent
                                  ? "bg-amber"
                                  : isPassed
                                    ? "bg-moss"
                                    : "bg-line-strong",
                            )}
                          />
                        </div>
                        <div className="mt-2 truncate text-[12.5px] font-medium text-paper">{st.name}</div>
                        <div className="mt-1 truncate font-mono text-[9.5px] text-faint">
                          {st.haltedHere ? "HALT · 401/429" : isUnreached ? "unreached" : st.file.split("/").pop()}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>

            {/* Synchronized 3-Pane Stage Readout */}
            <div className="grid border-t border-line-strong @3xl:grid-cols-12" aria-live="polite">
              {/* Pane 1: Stage Contract */}
              <div className="border-b border-line p-5 @lg:p-6 @3xl:col-span-5 @3xl:border-b-0 @3xl:border-r">
                <div className="flex items-center justify-between font-mono text-[10.5px]">
                  <span className="uppercase tracking-[0.15em] text-amber">
                    Stage {stage.num} · {stage.name}
                  </span>
                  <a
                    href={stage.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-muted hover:text-amber"
                  >
                    {stage.file} ↗
                  </a>
                </div>

                <p className="mt-3 text-[14.5px] leading-[1.74] text-paper/95">{stage.whatHappens}</p>

                <dl className="mt-5 space-y-3 border-t border-line pt-4 font-mono text-[11px]">
                  <div>
                    <dt className="uppercase tracking-[0.13em] text-faint">Stage Input</dt>
                    <dd className="mt-1 text-paper">{stage.input}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-[0.13em] text-faint">Stage Output</dt>
                    <dd className="mt-1 text-amber">{stage.output}</dd>
                  </div>
                  <div className="border-t border-line pt-3">
                    <dt className="uppercase tracking-[0.13em] text-rust">Failure Conditions & Boundaries</dt>
                    <dd className="mt-1 leading-relaxed text-muted">{stage.failureModes}</dd>
                  </div>
                </dl>
              </div>

              {/* Pane 2 & 3: Implementation Code + Architectural Cross-links */}
              <div className="bg-[rgba(3,12,34,0.62)] p-5 @lg:p-6 @3xl:col-span-7 flex flex-col justify-between">
                <div>
                  <p className="label mb-3 text-faint">Implementation Excerpt ({stage.file})</p>
                  <CodeBlock
                    code={stage.code}
                    lang="c"
                    path={stage.file}
                    href={stage.href}
                    highlights={[1, 2]}
                  />
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 font-mono text-[11px]">
                  <span className="text-faint">
                    Stage {stageIdx + 1} of {scenario.stages.length}
                  </span>
                  <div className="flex flex-wrap gap-3">
                    <RouteLink to="/protocols" className="text-amber hover:underline">
                      Inspect Protocol Adapters →
                    </RouteLink>
                    <RouteLink to="/source" className="text-muted hover:text-paper">
                      Open Full Source Atlas →
                    </RouteLink>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </section>
    </div>
  );
}
