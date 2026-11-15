# YAG Desktop (initial LAN client)

YAG Desktop is a **native, optional client** for the existing YAG Host.
It provides a multi-conversation chat workspace, safe Markdown/code rendering,
model selection, inference settings, streaming responses, cancellation, and a
server connection dialog with optional LAN discovery. **The client never runs Ollama
or model weights**. Host-side model management, rate limiting, GPU telemetry
and administration remain on the central machine.

This is the first desktop milestone, not a complete LM Studio replacement.

## Requirements

- A running YAG LAN Host and at least one installed inference model.
- A scoped **inference+models** API key created by the host administrator.
- A trusted HTTPS certificate. Install the root CA exported by
  `python scripts/lan.py ca` on each client machine. TLS verification is
  mandatory; no insecure bypass is offered.
- For building locally: Node.js 20+, npm, Rust toolchain and Tauri 2
  platform prerequisites. See https://v2.tauri.app/start/prerequisites/.

## Start in development

From the repository root:

```sh
cd desktop
npm install
npm run dev
```

To package the native application:

```sh
npm run build
```

GitHub Actions `.github/workflows/desktop.yml` builds the client on
Windows, Linux and macOS. The workflow uploads native build artifacts.
These packages are unsigned; operating systems may warn until a
signing/notarization pipeline is configured.

## Connect

1. On the YAG Host, initialize and start the LAN deployment as documented
   in `docs/deployment/lan-hub.md`. Install a model.
2. Export and trust the **public** Caddy root certificate on the client
   machine. Never distribute the Caddy private CA key.
3. Open YAG Desktop, enter the host origin (for example
   `https://192.168.1.50`) and the individual client API key.
4. Select an available model in the sidebar and send a message.

Use `http://127.0.0.1:8080` only when the client and gateway are running
on the same machine. Plaintext HTTP to other LAN machines is deliberately
blocked. For remote hosts, use HTTPS with a trusted certificate.

## Security and privacy

- The API key is held **only in process memory**. It is not stored in
  localStorage, a configuration file, logs or a remote analytics service.
  You must re-enter it after restarting the application.
- Only the non-secret server URL is remembered locally.
- The native Rust HTTP bridge checks TLS certificates against the
  operating system's trusted root certificates. There is no
  `danger_accept_invalid_certs` option.
- The webview has no HTTP plugin, shell plugin or filesystem plugin.
  Its strict CSP blocks remote resources; model output is rendered as
  plain text, never interpreted as HTML.
- Conversations are retained in memory while the application runs. The user
  may **opt in** to persistent chat history from Preferences. When enabled,
  message text is stored unencrypted in the WebView's private application
  profile (not in YAG Host), bounded to 40 chats and 80 messages per chat.
  Deactivate the setting to erase saved history, or use Delete all history.
  **Do not enable persistent history for sensitive conversations** on a shared
  or unencrypted device. No API key is stored with this history.
- YAG Host computes trusted model transport flags from its own configured
  routes. Desktop marks external HTTPS, dedicated or **unverified** destinations
  and requires an explicit one-time confirmation per server/model for the
  current process. Consent is **not persisted**. An older Host without
  `yag_loopback_only` is treated as unverified, rather than silently safe.
  The operator must still control dedicated client scopes and billing.
  `yag_loopback_only` confirms that configured upstream endpoints use
  loopback; **it cannot prove that a local proxy never forwards cloud calls**.
  Static fallback routes and unreviewed provider registries require care.
- Client credentials are never granted host administrative privileges.
  The desktop uses only `GET /v1/models` and
  `POST /v1/chat/completions`.
- Host discovery reads multicast DNS-SD announcements but never authenticates
  based on them. HTTPS certificate validation and an individual scoped key are
  still required. No cloud provider key storage or provider subscriptions exist.
- The optional localhost relay uses its **own random in-memory token**.
  Only 127.0.0.1 is bound; it explicitly rejects Host-header rebinding,
  browser Origin headers, requests without the token and unsupported routes.
  It stops when Desktop exits, disconnects, or Stop relay is pressed.


## Optional mDNS discovery on the LAN Host

The Discover button searches for `_yag._tcp.local.` advertisements.
**YAG never connects automatically** to a discovered service. The server
operator must explicitly publish an announcement for the client to find:

```sh
python -m pip install zeroconf
python scripts/mdns_advertise.py --lan-ip 192.168.1.50 --name Colibri --port 443
```

Run this in a separate terminal on the **central Host**, while the
YAG + Caddy LAN stack is running. Replace the address with the Host's
actual private IPv4. The optional utility can be managed as an OS service,
but is not automatically started by Docker Compose. It publishes only the
address and display name, no keys or model identifiers. Multicast DNS must
be permitted by your operating system and network. Discovery does not
install CA roots or trust self-signed certificates automatically.

## Optional localhost API for IDEs and other applications

From the connected Desktop application open **Preferences** then **Start
local relay**. Copy the URL and *temporary relay token* into your
OpenAI-compatible application. Example:

```text
OpenAI base URL: http://127.0.0.1:49152/v1
API key:         yag-relay-<new-random-token>
Model:           an ID from the Desktop model list
```

The port is dynamically allocated, not necessarily 49152. The token
changes every time the relay starts and is **not** your YAG Host API key.
There is no public LAN listener, proxy of arbitrary URLs or automatic
browser CORS permission.

Supported: `GET /v1/models`, `POST /v1/chat/completions` (including
streaming). Other OpenAI endpoints such as Responses, embeddings and
Anthropic Messages remain available by connecting applications **directly
to YAG Host**, not through the local relay.

The relay forwards prompts to the configured central Host. It does not
provide confidentiality against malware on the **same client OS** and
should not be used to give untrusted local programs access to inference.

**Paid-provider isolation:** By default the relay publishes and accepts only
models not flagged by the Host as external HTTPS or dedicated. Its
`/v1/models` response lists only these explicitly allowed IDs, and chat
requests for other model IDs are rejected with HTTP 403 before contacting
the Host. The list is a snapshot taken when the relay starts, not an
automatically expanding inventory. Restart the relay after installing a
new model. Preferences offers a **per-start, explicit confirmation** to
include dedicated/external models when needed. This may incur charges or
send content outside your LAN; the option is neither persisted nor
implicitly enabled when reconnecting. The Host's scoped keys remain the
final authority. **Older Hosts or unrestricted default routes may fail
to label cloud models**, so operators must configure routing carefully
and enforce provider billing limits independently.

## Model quick switch and favorites

Use the **Find model** field in the sidebar to filter the Host model catalog
without making another network request. Press **Ctrl+K** (or **Cmd+K** on
macOS) to focus it; type a model name and press **Enter** to select the first
matching model. Press **Escape** to clear the search. Favorites appear
first in the list and can be pinned or unpinned with the adjacent star.

Favorites are saved only after the user explicitly clicks the star, and
are stored locally in the WebView profile as bounded model IDs grouped by
canonical Host origin (up to eight origins and 20 models per origin).
They never store client keys, prompts or model responses. Favorites are
not sent to a remote service and selecting a cloud model still requires
the separate per-session cloud egress confirmation.

## Conversation settings

Preferences allow a system prompt (up to 4000 characters), a temperature
from 0 to 2, and a token budget of 64–8192. Support for these settings
depends on the upstream model. The system prompt and live API key stay in
application memory; the opt-in local history does not persist them.
The **Copy chat** button exports the active conversation as Markdown to the
system clipboard only when explicitly pressed. Clipboard managers and other
local applications may retain that copy.

## Release checks and installer authenticity

**Preferences → Check for updates** queries the public `oakvx/yag` GitHub
Releases API and includes complete weekly experimental releases, release
candidates and stable versions. The separate **Check GitHub for updates
when Desktop starts** option is **disabled by default**. Enabling it
stores only a local boolean and checks once when the app starts (and
immediately when enabled). GitHub sees the network request's IP address;
no client API key, model ID, prompts or conversation text are sent.

When a newer compatible build exists, the update banner links to
Preferences. **Download verified installer** retrieves the platform-specific
package and `SHA256SUMS.txt` over HTTPS, enforcing fixed GitHub hosts,
release tag and asset-name allowlists, strict size limits and SHA-256
verification before writing a new file in the system Downloads folder.
A filename collision aborts the write rather than replacing files.
Unsupported architectures do not offer downloads. Release discovery and
all paths are generated natively, never accepted from renderer input.

**Important:** SHA-256 protects integrity relative to the published
checksum, but a checksum hosted alongside a binary does not establish
publisher identity. Use `gh attestation verify <package> --repo oakvx/yag`
for Sigstore provenance validation before manually running a downloaded
installer. This remains an explicitly confirmed, manual installation;
YAG does not silently execute, elevate or replace the running app.
Windows/macOS installers are currently unsigned at the operating-system
level pending Authenticode signing and Apple notarization. Unattended
installation is intentionally disabled until a signed update channel exists.

## Architecture

```text
Windows / macOS / Linux
+-------------------------------+
| YAG Desktop (Tauri webview)   |
|  - model selector             |
|  - streaming chat             |
|  - in-memory client key       |
|  - native Rust HTTPS bridge   |
+-------------------------------+
             | HTTPS + bearer key
             v
YAG Host /v1/* (Caddy TLS, LAN)
             |
      scheduler + rate limiter
             |
         Ollama / GPU
```

The desktop is an **optional interface**, not a required dependency:
third-party IDEs and scripts can continue to call the same YAG API.

## Deferred roadmap

A future BYOK (bring-your-own-key) provider layer may support Gemini,
OpenAI, Anthropic and other remote providers. It should be implemented
in YAG Host with encrypted credential storage, per-provider routing,
quotas and clear disclosure of which requests leave the LAN. No cloud
provider API keys are accepted by this initial desktop client.
