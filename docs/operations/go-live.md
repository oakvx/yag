# Go-live checklist — Colibri + BYOK providers

YAG remains experimental until the checks below have been completed on the
**actual hardware and model versions** intended for use. A passing mock CI
pipeline does not qualify real inference.

## 1. Protect the server before testing

- Bind YAG to loopback. Expose only the Caddy HTTPS listener on a trusted LAN.
- Install the public Caddy root CA on each client. Never copy private CA keys.
- Generate unique per-PC scoped credentials (inference + models). Retain the
  administrator key on the server only.
- Confirm `/api/admin/*` returns 404 through Caddy, and the untrusted LAN
  cannot reach port 8080 or Ollama directly.
- Verify the private `.env.lan`, runtime provider registry and backup locations
  are owned by the service user, non-world-readable and excluded from Git.
- Confirm there are no stale shared credentials; rotate compromised keys.

## 2. Qualify local models

1. Install the intended model in Ollama on Colibri.
2. From the central server run `python scripts/lan.py doctor`, `up`,
   `check` and `model MODEL_ID` as documented in the LAN setup guide.
3. Run `tests/live_model.py` against the exact model/runtime and record the
   date, model ID, Ollama version and hardware. Check both non-streaming and
   streaming if the client requires them; function tools must be tested
   explicitly, not inferred from model advertising.
4. If Colibri has an opt-in `yag-colibri` self-hosted runner, run
   **Actions → Qualify a real model on Colibri** manually from `main`.
   No public pull request is allowed to execute on a GPU runner.

## 3. Qualify cloud providers with your own key

1. Run `python scripts/lan.py provider-key set --alias YAG_POOL_KEY_1`.
   Input is hidden but the credential is in a **private, unencrypted** local
   environment file; protect the disk and restrict backup access.
2. Run `python scripts/lan.py providers add --url
   https://openrouter.ai/api/v1 --key-env YAG_POOL_KEY_1 --model
   YOUR_EXACT_MODEL_ID --exclusive-models` as one shell command.
   OpenAI and Gemini OpenAI-compatible endpoint URLs are documented in
   `cloud-providers.md`. A URL preset does not guarantee compatibility.
3. Restart the gateway. In the local Console verify the provider appears,
   the probe returns the expected model ID, and `GET /v1/models` exposes
   only enabled, operator-configured dedicated IDs.
4. Send one explicit test prompt and inspect the provider account's own
   usage/billing dashboard. Verify that tokens, rate limits and charges are
   acceptable before inviting additional clients.
5. Disable the dedicated backend. A request to its ID must fail closed (502
   or resource saturation), never be redirected to local Ollama, even when
   `YAG_FALLBACK_TO_DEFAULT=1`. Restore it only after the check.
6. Simulate a local Ollama outage. Enabled dedicated cloud model discovery
   and chat should continue to work when their own provider is reachable.

**Privacy boundary:** choosing a cloud model sends prompt text and tool
arguments to the selected provider. There is no per-request consent UI,
verified pricing, prepaid budget enforcement, native provider-specific API,
or encrypted-at-rest live secret vault.

## 4. Stress, recovery and cross-platform acceptance

| Gate | Pass condition |
| --- | --- |
| Multiple PCs | Two or more separate API keys work; revoked key is denied immediately |
| Dedicated model scopes | Ordinary client key receives 403; explicitly privileged PC can invoke cloud; a live scope downgrade blocks new cloud requests |
| Scheduler | Concurrent requests respect configured per-key, global and replica limits |
| GPU | Utilization/VRAM are either measured and source-labeled or explicitly unavailable |
| Network | Requests and streams survive normal load; cancellation frees inference slots |
| Failover | Dedicated models never leak to generic routes; no ambiguous streaming retry |
| Restore | An encrypted age backup can be checked and staged offline on a different machine |
| Desktop | The exact Windows/macOS/Linux installer is tested on a clean OS with trusted CA |
| Monitoring | Admin functions remain local; audit trail contains no prompts or credentials |
| Security | No critical dependency issues, exposed secrets, or unaudited public admin interface |

## 5. Release gate

- Merge reviewed code only after all required GitHub Actions checks pass.
- Verify Docker and LAN integration, release packaging and checksums.
- Qualify at least one real model; record known unsupported features in the
  release notes.
- Sign Windows and macOS installers once publisher identities are available.
  Until then, clearly label packages **unsigned**.
- Publish a reviewed semantic version tag to trigger the release workflow.
  Scheduled workflows generate **artifacts only**, not production releases.
- Back up configuration, run a documented rollback rehearsal, then deploy.

## Outstanding product work

A native encrypted BYOK credential vault, per-model price catalog and spending
budgets, stronger audited identity infrastructure, complete Anthropic/Gemini
native protocol adapters, capability-verified routing, full hardware telemetry
across operating systems, and signed desktop packages require separate design
and integration work. None of these can be declared done from a mock CI run.
