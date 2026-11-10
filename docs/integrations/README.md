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

## Anthropic Messages — text only

YAG supports non-streaming text requests to \`POST /v1/messages\` with YAG's bearer authentication. This is **not** a drop-in replacement for the Anthropic SDK or Claude Code: it does not implement the native \`x-api-key\` header, streaming events, tool use, system content blocks, or token counting.

For example, when a supported upstream model is running:

\`\`\`sh
curl http://127.0.0.1:8080/v1/messages \
  -H "Authorization: Bearer $YAG_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"YOUR_MODEL_ID","max_tokens":128,"messages":[{"role":"user","content":"Hello"}]}'
\`\`\`

The backend must return a single assistant text choice with prompt and completion token counts. The adapter rejects unsupported request and response types instead of silently discarding tool calls.

## Codex and Claude Code — not supported yet

Codex still needs additional Responses features and verified tool cycles; see [Codex configuration and probe](codex.md). Claude Code requires Anthropic streaming and tool semantics that are not implemented in YAG. No Claude Code compatibility tests have been run.
