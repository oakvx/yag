# Opt-in real inference compatibility

Mock CLI qualification is **not real-model qualification**. This script
exercises an actual OpenAI-compatible upstream configured by the operator,
with no committed or hardcoded provider credentials.

```sh
cmake -S . -B build && cmake --build build -j
export YAG_REAL_UPSTREAM_URL=http://127.0.0.1:8000/v1
export YAG_REAL_MODEL=YOUR_REAL_MODEL_ID
# Only for providers needing authentication:
# export YAG_REAL_UPSTREAM_KEY='...'
python3 tests/real_provider_probe.py --host ./build/yag

# If the model natively supports function tool selection:
python3 tests/real_provider_probe.py --host ./build/yag --tools
```

The probe validates non-streamed Chat, Chat SSE termination, basic Responses
translation, and optionally the selected function call. It does not establish
Claude Code or Codex support: run their real-model workflows separately.
If any provider does not support the necessary Chat parameters the test fails.
This is intentional; YAG should not fabricate unsupported features.

No prompts, API keys, upstream URLs or payload contents are printed by this
probe; only bounded status/validation failures are reported. It is opt-in and
not executed as a CI required gate, because the repository contains no live
model credentials.
