# Architecture and implementation status

## Implemented path

```
Client → bounded HTTP/1.x listener → bearer authentication → route validation
       → OpenAI-compatible upstream adapter (libcurl) → inference server
       ← streamed bytes / upstream status and content type ←
```

Each accepted connection has one detached worker, subject to a 32-connection limit. Receive/send timeouts and a total upstream timeout bound work. The request buffer belongs to the worker and is freed when the connection closes. libcurl owns its transfer state until the adapter returns; response data is sent directly to the socket. Configuration is immutable after startup except counters guarded by a mutex. The backend URL and credentials are host-side configuration. Logs contain startup information only, not prompt bodies.

Model-specific upstream routes can be provided as a bounded JSON environment variable; route selection is exact model ID matching, with the original single upstream as the default. Route credentials are read from dedicated host environment variables; routing has on-demand HTTP `/models` probes and an opt-in fallback restricted to pre-response connection/DNS failures; an opt-in per-route circuit breaker suppresses repeated DNS/connect failures for a configurable cooldown, but continuous active health probes and latency-aware backend selection remain unimplemented. The Chat Completions adapter remains a **transparent proxy**, not a canonical representation. The JSON parser checks only a top-level model string and messages array; all other parameters, tools, messages and upstream response data are passed unchanged. This preserves supported fields but does not check or translate backend capabilities. In particular, compatibility depends on the actual upstream. Model discovery merges the default upstream model list with statically configured model route identifiers; route entries identify configuration, not backend availability or capability.

The custom POSIX socket server is a small foundation and has not undergone a security audit or production hardening. Console assets now use `openat` with per-component symlink rejection; request-body memory is allocated after header authentication. It supports authenticated `Expect: 100-continue`, and SIGTERM/SIGINT drain active workers before libcurl cleanup. It is not portable ISO C alone: it relies on POSIX sockets and pthreads. It uses one request per connection, does not accept chunked request bodies, and has no keep-alive. Upstream redirects are disabled. SIGINT/SIGTERM now trigger graceful worker draining, verified by a dedicated slow-request test; abrupt process kills are not graceful. Chat Completions and Responses check for client EOF in libcurl's progress callback and the transport's 100 ms multi-poll loop, including when an upstream is silent, so cancelled requests release the transfer promptly. This requires clients to keep their write side open while awaiting a response. A Chat Completions upstream can send an arbitrarily long stream until the timeout. No request payload is persisted by YAG.

## Responses API subset

`POST /v1/responses` parses and validates request JSON, translates supported input to a Chat Completions request, and consumes the upstream response into an internal bounded text/function-call item representation. The request adapter, upstream HTTP transport and Responses event serializer are separate; this is not yet the general canonical data model required for all protocols. The unchanged Chat proxy shares the libcurl transport. The gateway never executes tools.

Supported: text string or structured text messages, instructions, function definitions, selection and multiple calls, complete `function_call`/`function_call_output` replay using `call_id`, generation settings (`max_output_tokens` maps to upstream `max_tokens`), `parallel_tool_calls`, `text.format` text/JSON object/JSON schema, `text.verbosity`, `reasoning.effort`, and `prompt_cache_key` mapped to Chat fields. Metadata is returned in the Responses object, not sent upstream. Upstream/model support for forwarded options is not guaranteed. `store: false` is supported; omitted `store` is also treated as false, unlike APIs that default to persistence. Opaque `client_metadata` objects are accepted as optional client annotations but are not forwarded or stored. `include: []` and the optional `reasoning.encrypted_content` projection are accepted. Because Chat Completions does not return Responses reasoning items, the adapter does not return encrypted reasoning, and it still rejects replayed reasoning items; other projections are explicitly rejected.

Non-streaming emits basic Response objects. Streaming consumes Chat SSE incrementally and emits named Responses events with per-stream sequence numbers, text and function-argument deltas, completed items, and completed/incomplete terminal events. A malformed or prematurely closed stream emits `error` once streaming has started; earlier upstream HTTP errors retain their status and body. Usage is reported only when the upstream provides complete prompt/completion/total counts; detailed token breakdowns and reasoning content are not emitted. The adapter rejects upstream refusal, reasoning content, legacy function-call and audio output instead of silently dropping them.

Limits: 4 MiB total upstream data per Responses request, 64 output items, 1 MiB incoming requests. Calls are accepted as function tools only. Image/audio/file inputs, non-string tool outputs, built-in and namespace tools, reasoning summaries, actual encrypted reasoning items, stateful conversations, `previous_response_id`, `store: true`, and unrecognized fields are explicitly rejected. The adapter cannot reconstruct or report provider-specific reasoning. Function call ID/name fragments must be available before the first argument delta; a later change after the item is announced is rejected. Some backends reject translated fields or do not support tool calls; YAG now has an operator-declared per-route capability registry and opt-in rejection of tools, streaming and reasoning when declared unsupported; it still lacks automatic model capability discovery or verification. A completed response does not guarantee that a particular model is suitable for an agent.

**Codex: mock protocol integration verified, real inference compatibility unqualified.** Codex CLI 0.167.0 now completes both a text SSE turn and a real `exec_command` shell tool cycle when routed through YAG to its deterministic mock Chat backend. The CLI executes `pwd`, returns the tool result, and receives the final response. `include`, `client_metadata`, optional reasoning summary selectors and namespace function tools are translated or validated, without fabricating unavailable reasoning. The probe disables `web_search`: that hosted tool is not implemented by YAG. No actual inference model or all-tool compatibility has been verified. See [Codex probe](../integrations/codex.md).

## Anthropic Messages (limited)

The `POST /v1/messages` adapter accepts text-only messages with optional SSE streaming, optional string or text-block-array system prompt (cache hints validated but not applied), `max_tokens`, temperature, `top_p` and stop sequences. Non-streaming requests require upstream token counts; streaming messages translate Chat SSE into Anthropic `message_start`, content-block, delta, stop and `message_stop` events. Tool input JSON is reconstructed from accumulated Chat function-argument fragments before emitting a `tool_use` block. It accepts tool declarations and maps their JSON input schemas to Chat function tools. Upstream Chat function calls are mapped into Anthropic `tool_use` content blocks (including parsed JSON object arguments), but assistant `tool_use` blocks can be replayed as Chat function calls. Result-only user messages with string `tool_result` content are mapped to Chat tool messages, completing the basic non-streaming tool call/result replay cycle. User tool results can include string or text-block-array content, optional `is_error` (marked in the Chat tool content), and trailing text blocks after results; nontext tool content is rejected. It accepts validated `thinking.enabled` and `thinking.adaptive` as best-effort Chat `reasoning_effort` mapping (high/medium), **without** exact thinking budget enforcement or native thinking blocks. `context_management` is accepted only for `clear_thinking_20251015` with validated `keep` because replayed thinking blocks are not supported in YAG; clearing past tool results is explicitly rejected. It still does **not** support `count_tokens`, images/audio or built-in server tools. A real Claude Code CLI has completed streaming text and client-side Read-tool cycles against the deterministic mock backend, but no real inference model has been qualified. See [Claude Code](../integrations/claude-code.md). Clients can authenticate to YAG using bearer or `x-api-key` headers; upstream keys stay private.

## Not implemented

- A comprehensive cross-protocol canonical representation; automatic capability discovery or testing; runtime provider editing and general-purpose health-aware failover. Declared model capability hints, configurable circuit breakers and opt-in fallback on safe pre-response failures are now implemented. Static per-model routing, merged `/v1/models` discovery and on-demand HTTP reachability probing are implemented, but do not imply model capability verification.
- Full Responses/Codex compatibility, stateful response storage and unsupported features described above. Anthropic token counting, multimodal content, native prompt caching, built-in tools, and unverified Claude Code message variants. The Messages adapter implements a bounded text/function-call subset in both streaming and non-streaming modes and rejects unsupported content.
- Identity-aware API key administration (scopes, revocation without restart, issuance/rotation), network-level abuse protection, configured CORS, native TLS, encrypted secret storage and structured/audit logs. Additional static bearer keys now support optional inference-only scopes, alongside a per-key fixed-window rate limit; neither feature replaces runtime revocation or production access controls.
- Request history, token-usage aggregation, CPU/RAM/GPU monitoring, full backend settings, model capability management and provider editing in the Console. In-memory counters now include upstream attempts, transport failures, HTTP errors, successes, aggregate transport duration and circuit rejections; these are not per-key token attribution or verified successful generations.
- The playground is text-only, and stores conversation only in React state until navigation/reload. It reports malformed/incomplete streams and errors; it does not execute or render tool calls.

## Changes after PR #5

- Per-route capability declarations (`tools`, `streaming`, `vision`, `reasoning`,
  `max_context_tokens`) and authenticated inspection endpoint. Missing values
  remain unknown and are never inferred as supported.
- Optional `YAG_ENFORCE_MODEL_CAPABILITIES=1` blocks explicitly disallowed
  tool/stream/reasoning requests with 422. This policy is based on operator
  declarations, not live backend discovery.
- Opt-in circuit breaker for repeated pre-response connection errors, and
  expanded aggregate transport counters. No retries after accepted requests.
- Inference-only scopes for additional static gateway keys; primary key retains
  administrative access. Key revocation/rotation still requires restarting.
- Unprivileged multistage Docker image, Compose bound to host loopback by
  default, deterministic malformed-HTTP tests and an opt-in real inference
  provider probe. The real probe has **not** been executed automatically and
  cannot certify any actual provider without operator-supplied settings.
- Console presents capability declarations, route circuit status and aggregate
  transport metrics. Prompt bodies are not persisted as part of observability.

### Still outside implemented scope

A shared canonical cross-protocol data model; native multimodal or reasoning
semantics; accurate tokenizer-based Anthropic count_tokens; provider-native
prompt caching; stateful Responses; background active health checking, dynamic
runtime provider/credential administration, TLS termination inside the C
server, persisted usage or audit history, token-level billing and verified
compatibility with real inference models. These require dedicated protocol
design, backend qualifications and, for some features, actual provider APIs.

## Intended next increments

1. Replace or harden the listener and add protocol contract tests, cancellation and graceful lifecycle handling.
2. Add canonical messages, content blocks, tool calls/results, generation settings and streaming events, with explicit ownership, lossless mappings and capability rejection.
3. Qualify the updated Responses and Anthropic streaming/tool adapters with actual models and complete Codex/Claude Code tool cycles, and implement unsupported built-in or multimodal capabilities only where they can be performed without loss. Do not claim compatibility without executing those tests.
4. Add scoped credentials, revocation, stronger per-key quotas and TLS deployment with operational monitoring before production use.

The [libcurl tutorial](https://github.com/curl/curl/blob/master/docs/libcurl/libcurl-tutorial.md) and [yyjson API](https://github.com/ibireme/yyjson/blob/master/doc/API.md) were consulted. Codex's own [configuration entry point](https://github.com/openai/codex/blob/main/docs/config.md) links to its current configuration reference; merely configuring `wire_api = "responses"` would not make this implementation compatible.
