# Integrations

## OpenAI-compatible applications

Set the SDK base URL to `http://127.0.0.1:8080/v1` (or the URL of your TLS-protected reverse proxy), set its API key to `YAG_API_KEY`, and choose a model ID returned by `GET /v1/models`. This is a Chat Completions proxy; support for individual request parameters, streaming and tool calls depends on the upstream.

Example using the Python OpenAI SDK, installed separately:

```python
import os
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8080/v1", api_key=os.environ["YAG_API_KEY"])
result = client.chat.completions.create(
    model="YOUR_MODEL_ID", messages=[{"role": "user", "content": "Hello"}]
)
print(result.choices[0].message.content)
```

The Console's Integrations page generates a cURL example using the current browser origin and discovered model. Never put a real key into a committed example.

## Anthropic Messages — streaming and text/function tools

YAG supports non-streaming requests to `POST /v1/messages` with either `Authorization: Bearer <YAG_API_KEY>` or `x-api-key: <YAG_API_KEY>`. The key authenticates to YAG, not the inference provider. Both headers together are rejected. The adapter supports text, SSE streaming, function-tool definitions, tool-use and tool-result replay, system text blocks and error-marked tool results. It is **not yet a verified drop-in replacement for Claude Code**: token counting, multimodal messages, server-side tools and some request shapes remain unsupported.

For example, when a supported upstream model is running:

```sh
curl http://127.0.0.1:8080/v1/messages \
  -H "Authorization: Bearer $YAG_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"YOUR_MODEL_ID","max_tokens":128,"messages":[{"role":"user","content":"Hello"}]}'
```

Claude Code may authenticate with `ANTHROPIC_AUTH_TOKEN` (sent as `Authorization: Bearer`) or `ANTHROPIC_API_KEY` (`x-api-key`); both values must be YAG gateway keys. The non-streaming backend must return a single assistant text choice with prompt and completion token counts. The adapter rejects unsupported request and response types instead of silently discarding tool calls.

## Real-model validation

Run the [opt-in real-model qualification script](live-model.md) or the [isolated-host probe](real-model.md) against a running YAG gateway and a model you control. Text, SSE and tool-result replay can be checked individually; no real-model checks are executed in the default CI.

## Codex and Claude Code — mock CLI tool cycles verified

Codex CLI 0.167.0 and Claude Code CLI both completed streaming text and local tool execution cycles against a deterministic mock backend. See [Codex](codex.md) and [Claude Code](claude-code.md) for setup and limitations. These tests do not establish compatibility with real inference models; YAG never executes client tools.
