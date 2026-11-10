# Architecture and implementation status

## Implemented path

```
Client → bounded HTTP/1.x listener → bearer authentication → route validation
       → OpenAI-compatible upstream adapter (libcurl) → inference server
       ← streamed bytes / upstream status and content type ←
```

Each accepted connection has one detached worker, subject to a 32-connection limit. Receive/send timeouts and a total upstream timeout bound work. The request buffer belongs to the worker and is freed when the connection closes. libcurl owns its transfer state until the adapter returns; response data is sent directly to the socket. Configuration is immutable after startup except counters guarded by a mutex. The backend URL and credentials are host-side configuration. Logs contain startup information only, not prompt bodies.

The Chat Completions adapter remains a **transparent proxy**, not a canonical representation. The JSON parser checks only a top-level model string and messages array; all other parameters, tools, messages and upstream response data are passed unchanged. This preserves supported fields but does not check or translate backend capabilities. In particular, compatibility depends on the actual upstream. Model discovery is also forwarded unchanged.

The custom POSIX socket server is a small foundation and has not undergone a security audit or production hardening. It is not portable ISO C alone: it relies on POSIX sockets and pthreads. It uses one request per connection, does not accept chunked request bodies, and has no keep-alive. Upstream redirects are disabled. It does not support signal-driven graceful shutdown. Chat Completions and Responses check for client EOF in libcurl's progress callback, including when an upstream is silent, so cancelled requests release the transfer promptly. This requires clients to keep their write side open while awaiting a response. A Chat Completions upstream can send an arbitrarily long stream until the timeout. No request payload is persisted by YAG.

## Responses API subset

`POST /v1/responses` parses and validates request JSON, translates supported input to a Chat Completions request, and consumes the upstream response into an internal bounded text/function-call item representation. The request adapter, upstream HTTP transport and Responses event serializer are separate; this is not yet the general canonical data model required for all protocols. The unchanged Chat proxy shares the libcurl transport. The gateway never executes tools.

Supported: text string or structured text messages, instructions, function definitions, selection and multiple calls, complete `function_call`/`function_call_output` replay using `call_id`, generation settings (`max_output_tokens` maps to upstream `max_tokens`), `parallel_tool_calls`, `text.format` text/JSON object/JSON schema, `text.verbosity`, `reasoning.effort`, and `prompt_cache_key` mapped to Chat fields. Metadata is returned in the Responses object, not sent upstream. Upstream/model support for forwarded options is not guaranteed. `store: false` is supported; omitted `store` is also treated as false, unlike APIs that default to persistence. Opaque `client_metadata` objects are accepted as optional client annotations but are not forwarded or stored. An empty `include: []` is accepted, but any requested extra output fields (including encrypted reasoning) are rejected because they cannot be synthesized.

Non-streaming emits basic Response objects. Streaming consumes Chat SSE incrementally and emits named Responses events with per-stream sequence numbers, text and function-argument deltas, completed items, and completed/incomplete terminal events. A malformed or prematurely closed stream emits `error` once streaming has started; earlier upstream HTTP errors retain their status and body. Usage is reported only when the upstream provides complete prompt/completion/total counts; detailed token breakdowns and reasoning content are not emitted. The adapter rejects upstream refusal, reasoning content, legacy function-call and audio output instead of silently dropping them.

Limits: 4 MiB total upstream data per Responses request, 64 output items, 1 MiB incoming requests. Calls are accepted as function tools only. Image/audio/file inputs, non-string tool outputs, built-in and namespace tools, reasoning summaries/encrypted reasoning, stateful conversations, `previous_response_id`, `store: true`, and unrecognized fields are explicitly rejected. The adapter cannot reconstruct or report provider-specific reasoning. Function call ID/name fragments must be available before the first argument delta; a later change after the item is announced is rejected. Some backends reject translated fields or do not support tool calls; YAG does not have a model capability registry. A completed response does not guarantee that a particular model is suitable for an agent.

**Codex: not yet compatible.** An actual Codex CLI 0.167.0 run against the deterministic mock backend failed with HTTP 400 on `include`. The observed request also contained `client_metadata`, `reasoning.summary`, namespace tools and `web_search`; these are outside the implemented subset. The test did not reach inference. No actual Codex tool cycle or real model has been verified. See [Codex probe](../integrations/codex.md).

## Not implemented

- A comprehensive cross-protocol canonical representation; explicit model capability descriptions; multiple providers and configuration management; provider health checks.
- Full Responses/Codex compatibility, stateful response storage and unsupported features described above. Anthropic Messages/count_tokens, Claude Code headers, events and tool semantics; those paths return 501.
- Per-client keys/scopes/revocation, administrative authorization, rate limiting, configured CORS, native TLS, encrypted secret storage, structured/audit logs, and access controls beyond one bearer key.
- Request history and usage aggregation, CPU/RAM/GPU monitoring, full backend settings, model capability management, and provider editing in the Console.
- The playground is text-only, and stores conversation only in React state until navigation/reload. It reports malformed/incomplete streams and errors; it does not execute or render tool calls.

## Intended next increments

1. Replace or harden the listener and add protocol contract tests, cancellation and graceful lifecycle handling.
2. Add canonical messages, content blocks, tool calls/results, generation settings and streaming events, with explicit ownership, lossless mappings and capability rejection.
3. Complete and qualify Responses against current Codex request shapes, actual models and full tool loops; implement Anthropic separately. Do not claim compatibility without executing those tests.
4. Add scoped credentials, revocation, rate limiting, TLS deployment and operational monitoring before production use.

The [libcurl tutorial](https://github.com/curl/curl/blob/master/docs/libcurl/libcurl-tutorial.md) and [yyjson API](https://github.com/ibireme/yyjson/blob/master/doc/API.md) were consulted. Codex's own [configuration entry point](https://github.com/openai/codex/blob/main/docs/config.md) links to its current configuration reference; merely configuring `wire_api = "responses"` would not make this implementation compatible.
