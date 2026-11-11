# Codex CLI: configuration and qualification

**Mock integration verified, real-model compatibility not yet qualified.** On 2026-11-10 the Codex CLI v0.167.0 completed both a streamed text turn and a real client-side `exec_command` tool cycle via YAG's Responses adapter. The deterministic mock upstream requested `pwd`, Codex executed it, returned tool output, and then received a final assistant reply. GitHub Actions runs both probes. These results establish one version-specific local protocol path, not arbitrary-model, server-side web-search, or production compatibility.

## Provider configuration

The current official [Codex configuration reference](https://developers.openai.com/codex/config-reference) documents `model_provider`, `base_url`, `env_key`, and `wire_api = "responses"`. Provider configuration belongs in the user-level `~/.codex/config.toml` (or `config.toml` under a separate `CODEX_HOME`), not a project-local config. Use an actual model ID returned by YAG; the following placeholder must be replaced:

```toml
model = "REPLACE_WITH_MODEL_ID_FROM_YAG"
model_provider = "yag"
web_search = "disabled" # YAG does not implement server-side web search

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

The isolated probes disable the built-in `web_search` tool because a local Chat Completions backend cannot implement server-hosted search implicitly. The text-turn and shell-tool cycle now pass on the mock model, but qualification on a real inference model and with more tool types remains necessary. Codex executes the tools; YAG only converts requests and responses. See OpenAI's [gateway compatibility requirements](https://developers.openai.com/codex/enterprise/gateway-compatibility).

## Repeat the isolated mock probe

Both probes start an isolated Host and mock backend on localhost and use a temporary `CODEX_HOME` and working directory. The text probe runs a greeting; `--tool-cycle` runs a command through Codex and checks that its output is replayed to the adapter. It requires a Codex CLI executable and Python 3. It returns nonzero when the turn fails. From the repository root:

```sh
cmake -S . -B build && cmake --build build -j
# If Codex is already installed:
python3 tests/codex_probe.py --host ./build/yag
python3 tests/codex_probe.py --host ./build/yag --tool-cycle
# Or obtain the version used for the recorded test outside the repository:
npm install --prefix /tmp/yag-codex --no-save @openai/codex@0.167.0
python3 tests/codex_probe.py --host ./build/yag --binary /tmp/yag-codex/node_modules/.bin/codex
```

The probes are separate from the mandatory `ctest` suites because they require the Codex CLI binary. They pass with the pinned CLI version in CI, but do not validate model capability. The temporary mock ID `response-stream` is not a real model.
