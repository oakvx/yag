# Codex CLI: configuration and qualification

**Not yet compatible.** A real Codex CLI 0.167.0 text-turn probe against YAG's deterministic mock Chat backend was attempted on 2026-11-10. It failed before reaching the upstream: YAG returned HTTP 400 for the unsupported `include` field. That client also sent `client_metadata`, `reasoning.summary`, a namespace tool and a web-search tool, none of which this adapter supports. A real model and an actual Codex tool cycle have not been tested. Do not interpret the configuration below as a working integration today.

## Provider configuration for future verification

The current official [Codex configuration reference](https://developers.openai.com/codex/config-reference) documents `model_provider`, `base_url`, `env_key`, and `wire_api = "responses"`. Provider configuration belongs in the user-level `~/.codex/config.toml` (or `config.toml` under a separate `CODEX_HOME`), not a project-local config. Use an actual model ID returned by YAG; the following placeholder must be replaced:

```toml
model = "REPLACE_WITH_MODEL_ID_FROM_YAG"
model_provider = "yag"

[model_providers.yag]
name = "YAG Local"
base_url = "http://127.0.0.1:8080/v1"
wire_api = "responses"
env_key = "YAG_API_KEY"
```

Start your OpenAI-compatible runtime and YAG as in the root README. In a separate shell set the same gateway key via a private environment or service manager and list models:

```sh
export YAG_API_KEY='REPLACE_WITH_THE_SAME_LONG_RANDOM_KEY_USED_BY_YAG'
curl -sS http://127.0.0.1:8080/v1/models -H "Authorization: Bearer $YAG_API_KEY"
# Put one returned data[].id in config.toml, then try:
codex exec --skip-git-repo-check --sandbox read-only 'Reply with a greeting.'
```

**Currently expected:** a 400 describing an unsupported request field or tool, depending on Codex version and configuration. After request-shape support is implemented, qualification still requires a suitable tool-capable model and an actual multi-turn tool call/result test; a greeting alone is insufficient. Codex performs tool execution, not YAG. See OpenAI's [gateway compatibility requirements](https://developers.openai.com/codex/enterprise/gateway-compatibility).

## Repeat the isolated mock probe

The probe starts its own Host and mock backend on localhost, uses a temporary `CODEX_HOME` and working directory, and requests a read-only text turn. It requires a Codex CLI executable and Python 3. It returns nonzero when the turn fails. From the repository root:

```sh
cmake -S . -B build && cmake --build build -j
# If Codex is already installed:
python3 tests/codex_probe.py --host ./build/yag
# Or obtain the version used for the recorded test outside the repository:
npm install --prefix /tmp/yag-codex --no-save @openai/codex@0.167.0
python3 tests/codex_probe.py --host ./build/yag --binary /tmp/yag-codex/node_modules/.bin/codex
```

The probe is deliberately separate from `ctest`: Codex is optional and this known failing compatibility check must not be misreported as a passing test. The temporary mock model identifier `response-stream` is only for this probe; it is not a real model.
