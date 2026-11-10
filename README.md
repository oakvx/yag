# YAG — Yet Another Gateway

**One host. Multiple models. Every interface.**

YAG is an early-stage, self-hosted inference gateway. This repository currently contains a native C17 host and a React/TypeScript Console. It forwards OpenAI Chat Completions to a default OpenAI-compatible inference server and supports up to 16 exact-model upstream routes. Model discovery still uses the default upstream, and a limited Responses-to-Chat adapter is included. It does not run inference or execute tools.

> **Status: foundation / experimental, not a production-ready multi-protocol gateway.** The Responses adapter supports a documented subset, but current Codex CLI requests do not yet work. A limited non-streaming text-only Anthropic Messages adapter is available. Anthropic streaming, tool calling, token counting, Claude Code and most administrative controls are still unsupported. Do not deploy this version on an untrusted network. See [scope and architecture](docs/architecture/STATUS.md).

## What works today

- Localhost HTTP server, public `/health`, and a primary bearer key plus optional additional keys protecting `/v1/*` and `/api/*`.
- Model discovery (`GET /v1/models`) and Chat Completions (`POST /v1/chat/completions`), including transparent upstream SSE streaming and tool call structures. The upstream decides what it supports; YAG does not independently validate capabilities or implement OpenAI semantics.
- A stateless Responses API subset with text, function calls and tool results, semantic SSE events, and explicit rejection of unsupported features. This does not yet support current Codex requests; see [Responses support](docs/architecture/STATUS.md).
- Text-only, non-streaming `POST /v1/messages` translation for basic Anthropic Messages clients. Requires upstream token usage and rejects unsupported tools or content types.
- A Console served by the Host, with session-only key entry, real host status/model discovery, text chat with cancellation, and copyable HTTP instructions. The playground does not handle tools; API clients can handle them themselves.
- Bounded incoming request size, connection count and socket/upstream timeouts; upstream credentials stay on the Host.
- Automated mock-upstream tests for authentication, framing, discovery, tool data, streaming, errors, timeout, disconnection and concurrency.

No actual model, Claude Code or live provider was tested. A Codex CLI 0.167.0 probe against the mock upstream was attempted and **failed** on an unsupported Responses request field; compatibility remains unachieved. The model listing is not a model health or capability guarantee.

## Build on Linux

Dependencies: CMake 3.16+, a C17 compiler, libcurl development headers/library, pthreads, Python 3 for tests, Node.js 18+ and npm for the Console. For example, on Debian/Ubuntu:

```sh
sudo apt install build-essential cmake libcurl4-openssl-dev python3 nodejs npm
cmake -S . -B build
cmake --build build -j
cd console && npm ci && npm run build && cd ..
ctest --test-dir build --output-on-failure
```

yyjson 0.12.0 is vendored under `third_party/yyjson` with its license. The Console build is optional for API-only use; its generated assets are not committed. `YAG_ASSETS` defaults to `console/dist` relative to the Host's working directory.

## Run

Start an OpenAI-compatible inference server separately. For example, if its base API URL is `http://127.0.0.1:8000/v1`:

```sh
# Set secrets using a private service manager/environment, not in a public file.
export YAG_API_KEY='REPLACE_WITH_A_LONG_RANDOM_SECRET'
export YAG_UPSTREAM_URL='http://127.0.0.1:8000/v1'
# Only if required by your inference server:
# export YAG_UPSTREAM_KEY='YOUR_UPSTREAM_SECRET'
./build/yag
```

Open `http://127.0.0.1:8080`, select **API key**, and enter the YAG key. The Console uses session storage for the current tab. Keep the key private and clear it when finished. The upstream key is never exposed to the Console. API access works without a browser.

```sh
curl http://127.0.0.1:8080/health
curl http://127.0.0.1:8080/v1/models -H "Authorization: Bearer $YAG_API_KEY"
curl http://127.0.0.1:8080/v1/chat/completions \
  -H "Authorization: Bearer $YAG_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"YOUR_MODEL_ID","messages":[{"role":"user","content":"Hello"}],"stream":false}'
```

The supported Responses subset can also be exercised without Codex:

```sh
curl http://127.0.0.1:8080/v1/responses \
  -H "Authorization: Bearer $YAG_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"YOUR_MODEL_ID","input":"Hello","store":false,"stream":false}'
```

Use `"stream":true` for SSE if the upstream supports it. Chat Completions request and response bodies are passed through; errors and status codes from the upstream are forwarded. Responses requests are translated and validated as documented in the [implementation status](docs/architecture/STATUS.md). If a stream fails after headers are sent, the connection closes and its HTTP status cannot be changed; clients must detect incomplete streams.

## Configuration

Environment variables are read on startup. Restart to apply changes.

| Variable | Default | Purpose |
| --- | --- | --- |
| `YAG_API_KEY` | required | Primary gateway bearer key, at least 16 characters. Use a strong randomly generated key. |
| `YAG_EXTRA_API_KEYS` | empty | Optional comma-separated list of up to 16 additional bearer keys (each at least 16 characters); no commas inside keys. |
| `YAG_RATE_LIMIT_PER_MINUTE` | `0` | Per-key, fixed 60-second limit for authenticated `/api/*` and `/v1/*` requests (0 disables, maximum 60000). Excess requests receive HTTP 429. |
| `YAG_BIND` | `127.0.0.1` | Listen address; use `0.0.0.0` only deliberately. |
| `YAG_PORT` | `8080` | Listen port. |
| `YAG_UPSTREAM_URL` | `http://127.0.0.1:8000/v1` | HTTP(S) upstream API base URL; no trailing slash, query or fragment. |
| `YAG_UPSTREAM_KEY` | empty | Optional bearer key for upstream only. |
| `YAG_MODEL_ROUTES` | empty | Optional JSON array of up to 16 `{model,url,key_env?}` routes, checked at startup. A matched model uses the specified upstream; other models use the default. |
| `YAG_TIMEOUT` | `120` | Total upstream transfer timeout in seconds (1–3600); connect timeout is 10 seconds. |
| `YAG_ASSETS` | `console/dist` | Filesystem path to compiled Console assets. |

Example route configuration (secrets are read from a named environment variable, not embedded in JSON):

```sh
export YAG_ROUTE_KEY='YOUR_SECOND_BACKEND_SECRET'
export YAG_MODEL_ROUTES='[{"model":"my-other-model","url":"http://127.0.0.1:9000/v1","key_env":"YAG_ROUTE_KEY"}]'
```

The authenticated `GET /api/routes` endpoint lists configured model IDs without backend credentials or addresses. Currently `GET /v1/models` still lists only the default upstream. Configured routes can be called by ID; aggregate discovery is not yet implemented. There is no fallback after a matched backend fails.

Keys are supplied through the process environment; use your service manager's restricted secret provisioning and account permissions. Environment variables may be visible to privileged users or through process inspection. Additional keys allow distinct clients to authenticate, but there is no per-key identity, scope, revocation without restart, or usage attribution. There is no encrypted secret store, *unauthenticated* connection-level rate limiting, TLS server, CORS configuration, audit logging, request history, or administrative API. Rotating the single key requires restarting the Host. `/health` and Console assets are public; `/api/status` and `/v1/*` require the key. HTTP requests are limited to 1 MiB, headers to 16 KiB and concurrent connections to 32; chunked request bodies are not supported. Connections use HTTP/1.x and close after each request.

**Networking:** the default listener is localhost only. LAN binding is explicit and emits a warning. Plain HTTP exposes API keys and inference traffic to the network. For any remote use, terminate TLS at a trusted reverse proxy, restrict access with a firewall and independently assess this experimental server. Do not regard Wi-Fi membership as authentication. Native TLS and hardened network-facing operation are not implemented.

See [integration notes](docs/integrations/README.md), [Codex configuration and probe](docs/integrations/codex.md), and [architecture and limitations](docs/architecture/STATUS.md).
