# Cloud OpenAI-compatible backends (manual BYOK)

YAG Host can route selected model IDs through HTTPS upstreams. This is the
**OpenAI-compatible cloud routing layer**, not a full OpenRouter-like
catalog or a billing system. No public provider credentials belong in YAG
Desktop or in the GitHub repository.

## Supported API base paths

The Host's private Provider Manager permits these exact suffixes:

| Provider type | Example HTTPS upstream | Requirements |
| --- | --- | --- |
| OpenAI-compatible | `https://api.openai.com/v1` | OpenAI-compatible endpoint and model ID |
| OpenRouter-style | `https://openrouter.ai/api/v1` | A provider API key with compatible chat/models endpoints |
| Gemini OpenAI-compatible | `https://generativelanguage.googleapis.com/v1beta/openai` | Gemini API key and a model supported by Google's OpenAI-compatibility interface |

Other HTTPS servers may use the same approved suffixes. These are *endpoint*
compatibility rules, not endorsements or automatic model support guarantees.
HTTP is accepted only for previously allowed private/local `/v1` backends.
Never put API credentials into URL query strings, GitHub Actions variables
or version-controlled configuration.

## Configure an individual private provider credential

On the **central YAG Host**:

1. Obtain an API key from the provider you intend to use and review its
   pricing, privacy policy, data residency and retention practices.
2. Store the key **outside GitHub** as `YAG_POOL_KEY_1` in the Host's private
   environment or deployment secret manager. For a local, interactive setup:
   
   ```sh
   python scripts/lan.py provider-key set --alias YAG_POOL_KEY_1
   python scripts/lan.py provider-key list
   ```

   The first command prompts for the key with hidden input; it never puts the
   secret in shell history or prints it. It writes the restricted `.env.lan`
   file, which is **not encrypted at rest** by YAG. Use full-disk encryption or
   an external secret manager where required. For key rotation, repeat
   `provider-key set` and restart the gateway. To clear an unused alias, run
   `provider-key clear --alias YAG_POOL_KEY_1` after deleting its provider routes.
3. Restart the gateway process/container after changing environment
   variables. YAG must have loaded the key before a managed provider alias
   becomes usable.
4. Locally open the operator Console and Provider Manager, then configure
   the HTTPS base URL, credential alias `YAG_POOL_KEY_1`, and an **explicit
   list of model IDs** to offer through that backend.
5. In the local Console, select **Dedicated model IDs** for a cloud backend and
   supply at least one exact provider model identifier. Or add the backend with
   `--exclusive-models` in the CLI. This publishes its configured IDs in
   `GET /v1/models` and prevents fallback to Colibri's default Ollama
   backend, even if `YAG_FALLBACK_TO_DEFAULT=1`.
6. Check reachability and run a small real-model Chat test. The model must
   genuinely support the fields the application sends; model lists alone
   are not proof of capability.

The CLI also accepts approved HTTPS base paths, for example:

```sh
python scripts/lan.py providers add \
  --url https://openrouter.ai/api/v1 \
  --key-env YAG_POOL_KEY_1 \
  --model openai/gpt-4o-mini \
  --exclusive-models
```

The preceding model ID is an **illustration only**: verify the exact current
provider model ID and that your key has access before using it. Provider
listing, token accounting and pricing can change.

### Operator-reviewed pricing and estimated request allowance

The optional `provider-budget` CLI validates a private JSON pricing
assumption with exact model ID, **USD-only** input/output rates, an HTTPS
source URL, UTC review time (expires after **7 days**), assumed maximum
input/output token counts, a conservative safety multiplier of at least
1.5, and an operator planning budget. No prices are scraped or invented.

Example policy (illustrative numbers only; replace them with **current,
provider-verified quotes**):

```json
{
  "schema_version": 1,
  "model_id": "provider/my-model",
  "currency": "USD",
  "source_url": "https://example.com/pricing",
  "checked_at_utc": "2026-11-14T20:00:00+00:00",
  "input_usd_per_million": "2.00",
  "output_usd_per_million": "6.00",
  "assumed_max_input_tokens": 5000,
  "assumed_max_output_tokens": 1000,
  "safety_multiplier": "2.0",
  "planning_budget_usd": "1.00"
}
```

Save this in a private, untracked file, then run:

```sh
python3 scripts/lan.py provider-budget --policy /private/model-pricing.json
python3 scripts/lan.py providers add \
  --url https://openrouter.ai/api/v1 \
  --key-env YAG_POOL_KEY_1 --model provider/my-model \
  --exclusive-models --pricing-policy /private/model-pricing.json
```

The second command configures YAG's existing **per-process request count
ceiling** using the lower of any explicitly supplied
`--max-requests-per-run` and the calculated allowance. It refuses
multiple models, mismatched IDs, expired quotes, ambiguous currencies,
malformed prices or unscoped HTTP endpoints. Never commit live provider
keys or business-specific budget files.

**Not a spend guarantee:** the gateway does not measure/bound actual
input token counts, provider-side tools, caching, price changes or provider
billing. Request ceilings reset when the Host restarts or its pool registry
is edited. The operator must enforce real monetary limits in the **provider
billing dashboard** and reconcile actual invoices. This feature provides
price provenance and a conservative planning aid, not prepaid billing.

### Optional per-process request ceiling

When adding or editing a provider, set `max_requests_per_run` to a positive
integer (maximum 1,000,000), or configure **Maximum requests per server run**
in the local Console. Via CLI:

```sh
python scripts/lan.py providers add \
  --url https://openrouter.ai/api/v1 \
  --key-env YAG_POOL_KEY_1 \
  --model YOUR_EXACT_MODEL_ID \
  --exclusive-models \
  --max-requests-per-run 100
```

YAG reserves a count **before** initiating each upstream request. Once the
ceiling is exhausted, further admissions to that backend are rejected (HTTP
503) immediately, without entering the resource wait queue. Failed or
cancelled requests still count conservatively. Other backends, if eligible,
can serve their own models; dedicated IDs never fall back to a generic
backend.

This is an **in-memory, per-process safety ceiling**, not a financial budget.
It resets when YAG restarts or its provider registry is edited, and it does
not know input token prices, exchange rates or the provider's actual charges.
Do not use it as a monthly billing guarantee or a substitute for provider-side
spend limits. `GET /api/providers/pool` reports the configured ceiling and
requests already reserved, without exposing secrets or prompt text.

### Per-PC dedicated provider access

By default, a LAN client's `inference+models` key can use ordinary local
models, but **cannot invoke dedicated model IDs** configured with
`exclusive_models: true`. Such requests return HTTP 403 on all supported
`/v1/*` inference endpoints before any upstream call. Primary and legacy
`all` credentials remain privileged.

To authorize a specific workstation, open the local **LAN client keys**
section of the Console. Issue it a managed key with
`inference+models+dedicated` (or `inference+dedicated` when model discovery
is not required). A managed client's scope can subsequently be changed from
the same Console without changing its API key. Adding dedicated permission
requires explicit administrator confirmation. Scope edits are persisted and
apply to new requests immediately; requests already admitted are not canceled.

Bootstrap static keys can also use those values in `YAG_EXTRA_KEY_SCOPES`,
but their scope cannot be edited live: update the private environment and
restart the Host instead. Never issue the shared `all` scope to an ordinary
workstation.

**Limit:** this policy protects explicitly dedicated managed pool model IDs.
Static model routes and the default upstream are still operator-controlled.
Do not configure a paid public cloud provider as an unrestricted/default
backend if you expect local-only client isolation. Model discovery may still
list dedicated IDs for local-only clients; seeing an ID never grants permission
to invoke it. This is an egress authorization control, **not** a prepaid
spend cap or provider privacy guarantee.

### Security boundaries

- The **admin Console stays local to the Host**; client API keys cannot
  read or edit provider credentials.
- Host-side provider configuration persists the *environment variable
  reference*, not the provider's raw secret.
- The existing private environment store is **not encrypted at rest** by
  YAG. Use operating-system access controls, an external secrets manager
  or disk encryption where appropriate.
- Dedicated model IDs use only enabled backends that declare those IDs and
  `exclusive_models: true`. Disabled, unreachable or saturated dedicated
  backends fail closed. A model list entry reflects configuration, **not**
  provider reachability or capability. If multiple dedicated replicas declare
  the same ID, load balancing is limited to those dedicated replicas.
- **A declared model ID is not a billing policy.** Requests routed to a
  third-party HTTPS endpoint may incur charges and be subject to its data
  retention policies. 
- Using a cloud provider **sends inference content outside your LAN**.
  YAG does not currently offer per-request user consent, cost estimates,
  automatic cloud fallback decisions or billing enforcement.
- The upstream adapter is a bounded OpenAI-compatible passthrough.
  **Native** Gemini and Anthropic APIs, embedding/speech/image semantics,
  token counting and extended reasoning capabilities may require dedicated
  adapters; this configuration does not claim to implement them.
- For now the operator chooses explicit routes and provides/revokes
  credentials. A provider key entered by an end user through YAG Desktop
  is **not supported**.

Always use the test script described in
[real-model qualification](../integrations/live-model.md) before declaring
a particular backend/model combination compatible.
