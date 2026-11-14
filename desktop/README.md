# YAG Desktop (initial LAN client)

YAG Desktop is a **native, optional client** for the existing YAG Host.
It provides a chat workspace, remote model inventory, streaming responses,
cancellation and a server connection dialog. **The client never runs Ollama
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
- Conversation history is in memory only. It is cleared on application
  exit and on changing models/servers; YAG itself may have separate
  operator-side aggregate token metrics.
- Client credentials are never granted host administrative privileges.
  The desktop uses only `GET /v1/models` and
  `POST /v1/chat/completions`.
- No model auto-discovery/broadcast, telemetry export, cloud key storage,
  provider subscription or localhost OpenAI relay is included yet.

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
