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

## Codex and Claude Code — not supported yet

YAG implements a subset of Responses, but a real Codex CLI probe failed on unsupported request fields, so Codex is not yet compatible. See [Codex configuration and probe](codex.md). Claude Code expects the unimplemented Anthropic Messages API; `/v1/messages` and `/v1/messages/count_tokens` return 501. No Claude Code compatibility tests have been run.
