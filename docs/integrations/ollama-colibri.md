# YAG Universal: Ollama on Colibri

**For a central Colibri server serving multiple LAN PCs**, use the
[LAN AI Hub deployment](../deployment/lan-hub.md). It provides a
Compose stack with HTTPS, client-specific API keys and an optional
private Ollama container. The single-machine loopback examples below
are not a substitute for secure LAN deployment.

YAG provides a single **OpenAI-compatible gateway** for an Ollama instance
running on a machine such as **Colibri**. Applications authenticate to YAG,
not to Ollama. The upstream model executes inference; YAG routes and translates
requests. This does **not** make Ollama a public internet service.

## 1. Choose where YAG runs

### YAG and Ollama on the same machine

Run Ollama on Colibri, and set the following in the private shell/service
environment used to launch YAG:

```sh
export YAG_API_KEY="$(openssl rand -hex 32)"
export YAG_UPSTREAM_URL="http://127.0.0.1:11434/v1"
./build/yag
```

Ollama normally listens on port 11434. Do not add an Ollama API key unless
your upstream actually requires one. The `/v1` suffix selects Ollama's
OpenAI-compatible API, not its native `/api` API.

### YAG on a different computer in the same private network

```sh
export YAG_API_KEY="$(openssl rand -hex 32)"
export YAG_UPSTREAM_URL="http://colibri:11434/v1"
./build/yag
```

Replace `colibri` with the actual hostname or private IP reachable from the
YAG host. On Colibri, Ollama must explicitly listen on an interface reachable
from YAG; if it is loopback-only, the second setup will fail. Restrict access
to Ollama's port with a host firewall and private network/VPN. Plain HTTP on
the LAN is unencrypted. Prefer a private tunnel or HTTPS upstream when the
network is not fully trusted.

**Do not port-forward Ollama port 11434 or YAG port 8080 to the public
internet.** YAG's default listener is loopback-only. For other devices, use
a trusted TLS reverse proxy with authentication, or a private VPN with
appropriate access controls; keep Ollama private.

If using Docker Compose on the same machine as Ollama, the container's
`127.0.0.1` is not the host. See
[Docker deployment](../deployment/docker.md) for
`http://host.docker.internal:11434/v1` and its networking requirements.

## 2. Verify models and gateway

```sh
# On Colibri, list installed models; this is the native Ollama endpoint.
curl http://127.0.0.1:11434/api/tags

# From the machine running YAG:
curl http://127.0.0.1:8080/health
curl -H "Authorization: Bearer $YAG_API_KEY" \
  http://127.0.0.1:8080/v1/models
```

Use an exact ID returned by `data[].id`. Do not assume a model is installed,
loaded, or supports tools, JSON schemas, images, embeddings, or long context
just because it appears in the list.

## 3. Connect your applications

Use these values in any application that supports a custom OpenAI API:

| Setting | Value |
| --- | --- |
| Provider | OpenAI-compatible / Custom OpenAI |
| Base URL | `http://127.0.0.1:8080/v1` on the YAG host |
| API key | Your **YAG** gateway key, not an Ollama key |
| Chat model | An ID from `GET /v1/models` |
| Embedding model | An installed Ollama model that actually supports embeddings |

For a different device, replace localhost with your **private TLS/VPN**
gateway address. Apps that only accept a hardcoded vendor endpoint cannot
necessarily be configured to use YAG.

### OpenAI Python SDK

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url=os.environ.get("YAG_BASE_URL", "http://127.0.0.1:8080/v1"),
    api_key=os.environ["YAG_API_KEY"],
)
chat = client.chat.completions.create(
    model=os.environ["YAG_CHAT_MODEL"],
    messages=[{"role": "user", "content": "Ciao da Colibri"}],
)
print(chat.choices[0].message.content)
```

### OpenAI JavaScript SDK (server-side)

```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: process.env.YAG_BASE_URL ?? "http://127.0.0.1:8080/v1",
  apiKey: process.env.YAG_API_KEY,
});
const reply = await client.chat.completions.create({
  model: process.env.YAG_CHAT_MODEL,
  messages: [{ role: "user", content: "Ciao da Colibri" }],
});
console.log(reply.choices[0].message.content);
```

Keep the gateway key on the server. Do **not** embed it in a public browser
bundle, mobile application, or distributed client binary.

### Embeddings / RAG clients

```sh
curl -H "Authorization: Bearer $YAG_API_KEY" \
  -H "Content-Type: application/json" \
  http://127.0.0.1:8080/v1/embeddings \
  -d '{"model":"YOUR_INSTALLED_EMBEDDING_MODEL","input":["document one","document two"]}'
```

YAG forwards embeddings to the selected upstream. It does not create vectors,
index documents, implement a vector database, or convert chat-only models into
embedding models. Applications using retrieval-augmented generation still
need their own document indexing and retrieval layer.

### Legacy text completion clients

```sh
curl -H "Authorization: Bearer $YAG_API_KEY" \
  -H "Content-Type: application/json" \
  http://127.0.0.1:8080/v1/completions \
  -d '{"model":"YOUR_MODEL_ID","prompt":"Write a short greeting","stream":false}'
```

Completion support and streaming depend on the chosen Ollama model/runtime.
For modern chat apps, prefer `/v1/chat/completions`.

### Codex CLI and Claude Code

See [Codex](codex.md) and [Claude Code](claude-code.md). Both adapters passed
mock-backend CLI qualification, but **real Ollama models are not yet
qualified** for the complete tool, reasoning and streaming behavior expected
by those agents. Never grant tool execution permissions solely on the basis
of model discovery.

### Real Ollama qualification (opt-in)

Once YAG is running and a chat model plus an embedding model are installed,
run the existing real-model probe with the optional universal endpoints:

```sh
export YAG_CHAT_MODEL='YOUR_INSTALLED_CHAT_MODEL'
export YAG_EMBED_MODEL='YOUR_INSTALLED_EMBEDDING_MODEL'
python3 tests/live_model.py --model "$YAG_CHAT_MODEL" \
  --protocol chat --embedding-model "$YAG_EMBED_MODEL" --completions
```

The `--completions` flag is optional: omit it if your Ollama version or
selected model does not implement legacy completions. Similarly, omit
`--embedding-model` until you have an embedding-capable model installed.
These tests make real inference requests; the default CI uses mock models.

## 4. Additional providers

Set `YAG_MODEL_ROUTES` to forward selected exact model IDs to other
OpenAI-compatible backends. The default Ollama backend continues to serve
all other IDs. Route keys are referenced by environment variable name,
never embedded in JSON. See the root README.

## 5. Known limits

- YAG exposes OpenAI-compatible Chat, legacy Completions, Embeddings and a
  bounded Responses/Anthropic translation layer. It is **not** a native
  Ollama `/api/chat` or `/api/generate` proxy.
- Model IDs are not aliases: use the exact ID Ollama reports.
- Native TLS, per-user accounts, audit logging, browser CORS and dynamic
  administration are not implemented. Keep the gateway on loopback or
  behind a separately secured private proxy.
- Request bodies are limited to 1 MiB; bulk embedding ingestion must batch
  accordingly. Availability and output formats are controlled by Ollama.
- For a real-model smoke test, see
  [real-model qualification](real-model.md). Test Chat and Embeddings
  separately with actual installed models.
