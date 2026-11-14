# Qualifying YAG with a real inference backend

The CI uses deterministic mock inference. **Those checks do not prove that a
particular model supports tool calling or the fields YAG translates.**

Run an actual OpenAI-compatible inference backend (Ollama/vLLM/llama.cpp or a
trusted provider), start YAG with its default or routed upstream configured,
and choose a real model ID listed in your gateway. For example, with an
already-running local inference backend listening on port 8000:

```sh
export YAG_API_KEY="$(openssl rand -hex 32)"
export YAG_UPSTREAM_URL='http://127.0.0.1:8000/v1'
cmake -S . -B build && cmake --build build -j
./build/yag
```

In another shell, pass the **same** YAG_API_KEY through your environment (never
put secrets in command-line flags or tracked files):

```sh
python3 tests/live_model.py --model YOUR_MODEL_ID --stream
python3 tests/live_model.py --model YOUR_MODEL_ID --tools --stream
```

The optional `--tools` flag makes a **real model** choose a harmless fixture
lookup function, then verifies the tool result can be replayed through Chat
Completions, Responses, and Anthropic Messages. A client executes no external
action during this test. The tool request may fail if the backend lacks
function calling or refuses the model/tool_choice fields.

The `--stream` flag checks that each protocol stream reaches its terminal
event. Text tests and tool replay are separate; a passing text test alone
does not establish tool compatibility.

You can select one protocol with `--protocol chat`, `responses` or
`anthropic`. The script prints only pass/fail metadata, not prompts,
response bodies or API secrets. It requires HTTPS for non-loopback URLs.
It does not automatically acquire a model, incur provider costs, or certify
the security of a public deployment.

### Machine-readable evidence (Colibri only)

On a trusted, opt-in `yag-colibri` runner, the manual
`Qualify a real model on Colibri` workflow now generates
`qualification.json` and uploads it as a GitHub Actions artifact for 14
days, even on a failed protocol check when report generation succeeds.
You may also run locally with `tests/real_provider_probe.py
--host ./build/yag --report-json qualification.json` after supplying the
required `YAG_REAL_*` environment variables.

The report records a SHA-256 fingerprint of the exact model identifier,
the reviewed Git commit (when available), requested protocols and whether
text/tool replay and SSE terminal events succeeded or failed. It **never**
contains prompts, raw model responses, provider URLs or API keys. The file
is written owner-only on POSIX hosts and rejects symlink destinations
when `O_NOFOLLOW` is available. SHA-256 hashes do not make low-entropy
model names confidential: someone who guesses a public model name can
hash it and compare. Restrict workflow artifact readership accordingly.

**No result is marked verified by configuration alone.** Only a
real backend call on the intended runner produces evidence, and passing
does not certify unrelated model versions, tool types, deployments or
vendor guarantees.

**Passing these tests establishes only the selected model, runtime, CLI and
configuration combination.** Record the model ID, backend version, YAG commit
and successful checks in your own deployment notes before declaring support.
