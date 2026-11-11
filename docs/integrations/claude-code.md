# Claude Code CLI — local gateway compatibility

A real Claude Code CLI successfully completed (1) a streaming text turn and
(2) an actual local Read-tool cycle through YAG using a **deterministic mock**
Chat Completions backend. In the second test, Claude Code read a file under a
temporary directory, returned the tool result through YAG and received a
final assistant message.

**This is not qualification against a real inference model.** Native thinking
blocks, exact thinking budgets, image/audio content, native caching, native
token counting and built-in server tools are not implemented.

## Configuration

Claude Code uses the base URL **without** a trailing `/v1`. Use your
gateway API key, not the inference provider secret.

```sh
export ANTHROPIC_BASE_URL='http://127.0.0.1:8080'
export ANTHROPIC_AUTH_TOKEN="$YAG_API_KEY"
export ANTHROPIC_DEFAULT_SONNET_MODEL='YOUR_MODEL_ID'
export ANTHROPIC_DEFAULT_OPUS_MODEL='YOUR_MODEL_ID'
export ANTHROPIC_DEFAULT_HAIKU_MODEL='YOUR_MODEL_ID'

claude -p 'Reply with a greeting.' --model YOUR_MODEL_ID --max-turns 1
```

An upstream must understand the translated Chat messages, function schemas,
streaming chunks and optional `reasoning_effort`. YAG never executes tools.

## Translation boundaries

- `thinking.enabled` is mapped to Chat `reasoning_effort=high`; adaptive
  thinking to `medium`. This cannot enforce token budgets or produce genuine
  Anthropic thinking output.
- `context_management` accepts validated `clear_thinking_20251015` hints:
  YAG cannot replay prior thinking blocks, so none exist to clear. Tool-history
  clearing is rejected rather than silently discarded.
- `cache_control` metadata is validated but not applied as native prompt caching.
- Unknown semantic fields and unsupported content types are rejected.

## Reproduce local mock verification

```sh
cmake -S . -B build && cmake --build build -j
python3 tests/claude_probe.py --host ./build/yag
python3 tests/claude_probe.py --host ./build/yag --tool-cycle
```

The probes use a temporary home directory, private fixture and mock backend,
without production credentials. The tool-cycle probe grants only the local
`Read` tool via `--allowedTools Read`. CI records the tested CLI version.

For rejected request diagnostics, enable `YAG_TRACE_ANTHROPIC_SHAPE=1` on a
**local development instance**. Only allowlisted field names and content-block
types are printed, not actual prompt contents or credentials.
