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
