# YAG LAN AI Hub — central server with Colibri / Ollama

One central machine hosts the gateway and connects to an Ollama backend.
Other PCs on the **same trusted LAN** use one HTTPS OpenAI-compatible API.
They do not need to install Ollama or download the model weights.

```text
PC / IDE 1 --(HTTPS, key A)--\
PC / IDE 2 --(HTTPS, key B)---+--> 192.168.1.50:443 [Caddy TLS]
PC / automation --(key C)---/                  |
                                              v
                                       YAG :8080 (Docker only)
                                              |
                                              v
                                  Ollama :11434 (Docker only)
```

In **managed Ollama** mode, the Ollama service is not published on the
host network. The YAG Console is not published to the LAN either: open it
locally on the central machine at `http://127.0.0.1:8080`.
Only `/v1/*`, `/api/*` and `/health` pass through the LAN proxy.
YAG enforces bearer authentication and per-key request limits for API
requests; the reverse proxy terminates TLS.

## Prerequisites

- A central machine with Docker Engine + Docker Compose v2 (or Docker
  Desktop), Python 3.9+, enough RAM/storage for the selected Ollama model.
- A stable **private IPv4** for the server, ideally a DHCP reservation on
  the router. Example below: `192.168.1.50` (replace with the real address).
- TCP **443** reachable from trusted LAN clients, with a firewall restricting
  it to the intended LAN subnet. No router port forwarding.
- For CPU inference, no special GPU setup. For NVIDIA acceleration, see below.
- For browsers: do not embed YAG API keys in public JavaScript. Use a
  server-side client or a trusted application that securely stores its key.

## Option A — Fresh central server with Ollama in Docker (recommended)

This mode requires **no Ollama port exposed on the LAN** and keeps model
files in a persistent Docker volume.

```sh
python3 scripts/lan_bootstrap.py --lan-ip 192.168.1.50 \
  --clients 3 --managed-ollama

docker compose --env-file .env.lan \
  -f compose.yaml -f compose.lan.yaml -f compose.lan.ollama.yaml \
  up --build -d

# Pull an actual model. Replace the example with a model your hardware supports.
docker compose --env-file .env.lan \
  -f compose.yaml -f compose.lan.yaml -f compose.lan.ollama.yaml \
  exec ollama ollama pull llama3.2
```

The first start may download a large image. Model downloads also take time
and storage. Use `docker compose ... exec ollama ollama list` to inspect
installed model IDs. Embeddings require a separate embedding-capable model,
for example one you explicitly install with `ollama pull`.

### Optional NVIDIA GPU

If the central machine has a supported NVIDIA GPU, driver and NVIDIA
Container Toolkit, add the last overlay:

```sh
docker compose --env-file .env.lan \
  -f compose.yaml -f compose.lan.yaml -f compose.lan.ollama.yaml \
  -f compose.lan.nvidia.yaml up --build -d
```

This is opt-in; CPU-only hosts should not use the GPU overlay. GPU model
fit, VRAM consumption and concurrent inference are determined by Ollama
and the hardware, not by YAG.

## Option B — Reuse an Ollama already installed on Colibri

If Ollama is already installed on the **same central machine**, use the
external-host mode:

```sh
python3 scripts/lan_bootstrap.py --lan-ip 192.168.1.50 --clients 3

docker compose --env-file .env.lan \
  -f compose.yaml -f compose.lan.yaml up --build -d
```

This configures YAG to reach
`http://host.docker.internal:11434/v1`. Docker Desktop commonly
provides this hostname; on Linux the base Compose file maps it to the
Docker host gateway.

**Important:** Ollama often listens on `127.0.0.1:11434`, which may
not be reachable from a Linux Docker container. If so, configure Ollama
to listen on an address reachable from the Docker bridge and use a
**host firewall** to allow only the gateway/container source to reach
port 11434. Do not simply expose port 11434 to the LAN or Internet.
Validate reachability from the container:

```sh
docker compose --env-file .env.lan \
  -f compose.yaml -f compose.lan.yaml \
  exec yag curl --fail --silent http://host.docker.internal:11434/v1/models
```

If Ollama is on a **different** machine named Colibri, edit
`YAG_UPSTREAM_URL` in `.env.lan` to its private reachable address, e.g.
`http://192.168.1.60:11434/v1`. Restrict Ollama's firewall to the central
YAG server. Plain HTTP between separate hosts is unencrypted: use a
private trusted network or an encrypted tunnel. The managed option is
preferable if you want Ollama and YAG truly isolated on one host.

**Do not combine Option A and B with the same model directory without
planning a migration.** Docker-managed Ollama uses its own volume.

## TLS: trust the private CA on each client

The Caddy reverse proxy generates a private CA and issues a certificate
for the configured **IP address**. The private CA key stays in the
`yag-caddy-data` Docker volume. A new client will not trust that CA
until the administrator installs the root certificate.

On the central server, first trigger certificate issuance and export
the public root certificate:

```sh
# Bootstrap ONLY. -k is not for normal client connections.
curl -k https://192.168.1.50/health

docker compose --env-file .env.lan \
  -f compose.yaml -f compose.lan.yaml \
  cp caddy:/data/caddy/pki/authorities/local/root.crt ./lan-root-ca.crt

# Verify with certificate validation enabled:
curl --cacert ./lan-root-ca.crt https://192.168.1.50/health
```

For the managed Ollama mode, add `-f compose.lan.ollama.yaml` to the
`docker compose` commands above, so the command targets the same stack.

Copy **only** `lan-root-ca.crt` (the public certificate) to each client,
then import it into the client's trusted root store:

- **Windows (PowerShell as Administrator):**
  `Import-Certificate -FilePath .\lan-root-ca.crt -CertStoreLocation Cert:\LocalMachine\Root`
- **Debian / Ubuntu:** copy to
  `/usr/local/share/ca-certificates/yag-lan.crt`, then run
  `sudo update-ca-certificates`.
- **macOS:** use Keychain Access to import the certificate into System
  keychain and explicitly mark it trusted after verifying its fingerprint.

Installing a CA root extends trust to certificates it signs. Protect the
central Caddy volume, verify the certificate fingerprint out of band,
and install the root **only on devices you administer**. Do not copy the
CA private key or use `verify=False` / `-k` in production clients.

## Give each PC its own API key

The bootstrap creates two **private files** (excluded from Git):

- `.env.lan`: central configuration and **administrator key**. Never
  share it with client PCs.
- `lan-clients.txt`: `pc-01`, `pc-02`, etc. Give each PC only its
  own key. Keys have `inference+models` scope, so they cannot access
  monitoring or administrative endpoints.

The generated credentials are cryptographically random, never printed to
the terminal, and created with mode 0600 on POSIX hosts. Windows operators
must also check NTFS ACLs. The generator **refuses to overwrite** an
existing configuration. Rotate compromised keys manually and restart YAG;
dynamic key revocation is not yet implemented.

On a client PC, configure any OpenAI-compatible application with:

| Setting | Value |
| --- | --- |
| Base URL | `https://192.168.1.50/v1` |
| API key | The single key assigned to this PC in `lan-clients.txt` |
| Model | Exact ID returned by `GET /v1/models` |
| Protocol | OpenAI-compatible Chat / Completions / Embeddings |

Test a client after installing the root CA:

```sh
curl -H "Authorization: Bearer YOUR_PC_KEY" \
  https://192.168.1.50/v1/models

curl -H "Authorization: Bearer YOUR_PC_KEY" \
  -H "Content-Type: application/json" \
  https://192.168.1.50/v1/chat/completions \
  -d '{"model":"YOUR_INSTALLED_MODEL","messages":[{"role":"user","content":"Ciao"}]}'
```

For a first test **without installing** the root CA system-wide, use
`curl --cacert lan-root-ca.crt` instead. Do not distribute keys inside
public web pages or client-side bundles.

## Operational checks

```sh
# Compose syntax and effective port publishing (no secrets printed):
docker compose --env-file .env.lan -f compose.yaml -f compose.lan.yaml config --quiet

# Host-local health (always bound to loopback):
curl http://127.0.0.1:8080/health

# View services, avoid sharing logs with sensitive environment data:
docker compose --env-file .env.lan -f compose.yaml -f compose.lan.yaml ps

# Stop cleanly without deleting persistent CA/model volumes:
docker compose --env-file .env.lan -f compose.yaml -f compose.lan.yaml down
```

Append the managed-Ollama overlay to those commands when applicable.
Do **not** run `down -v`: that deletes model and CA volumes.
A `YAG_RATE_LIMIT_PER_MINUTE` of 120 per key is set by default; adjust
it in `.env.lan` for your workload. YAG limits **requests**, not GPU
time, token consumption, VRAM, or queue length. It currently supports up
to 16 additional API keys, 32 active HTTP connections and 1 MiB request
bodies. For many simultaneous heavy requests, Ollama may queue work or
exhaust VRAM; benchmark your hardware before increasing client count.

## Per-PC usage monitoring

On the central machine, open `http://127.0.0.1:8080` and enter the
**administrator key** from `.env.lan`. The Console's **Requests** page
lists `primary`, `client-01`, `client-02`, etc., with aggregate accepted
and rate-limited request counts. These labels correspond to the order
of `YAG_EXTRA_API_KEYS` in the private configuration.

The same information is available to a monitoring-authorized API key
at `GET /api/clients`. Ordinary `inference+models` client keys receive
HTTP 403. No key value, IP address, prompt or response body is returned.
Counters reset when the gateway restarts and do not represent GPU time
or generated tokens.

## Network and security boundaries

- **LAN only:** bind TCP 443 to a real RFC1918 server IP, use a firewall
  allowlist for the intended subnet, and do not configure WAN port forwarding.
  The IP binding alone is **not** a substitute for a firewall.
- **TLS:** Caddy issues an internal CA certificate for that IP; clients
  must trust the root CA. Renewed certificates are managed by Caddy.
- **Ollama:** managed mode has no host port mapping. Existing-host mode
  requires explicit network/firewall hardening on the host.
- **Console:** available on the central machine at
  `http://127.0.0.1:8080`, not via the LAN TLS proxy.
- **API access:** client keys are scoped to inference and model discovery.
  The primary administrator key remains on the central server.
- **No zero-trust claims:** there is no user directory, device identity,
  automatic key rotation, persistent audit database, TLS client cert
  authentication or built-in browser CORS policy.
- **No Internet access:** for remote use, deploy a separately secured
  VPN rather than opening router ports.

See also [Ollama / Colibri client integrations](../integrations/ollama-colibri.md)
and [Docker deployment](docker.md).
