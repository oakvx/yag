# YAG AI Datacenter — LAN control plane

The LAN overlay now includes **YAG Hub**, a private control-plane service.
Existing native C17 YAG remains responsible for OpenAI/Responses/Anthropic
translation; Hub adds the missing device and inference management features.
Hub runs in its own unprivileged Python 3.12 container, using the standard
library only, and is **not bound to any host port**.

```text
PCs (Windows / Linux / macOS) --HTTPS:443 /v1/*--> Caddy (private CA)
                                                 |
                                                 v
                                           Hub :8081
                             dynamic key auth / priority queue
                             /                 |              \
                         YAG :8080        node-A /v1       node-B /v1
                              |
                         Ollama :11434

Admin browser --HTTPS:443 /hub/--> authenticated management dashboard
```

**Quick start** on the machine hosting Docker:

```sh
python scripts/lan.py init --lan-ip 192.168.1.50 --clients 3 --managed-ollama
python scripts/lan.py doctor
python scripts/lan.py up
python scripts/lan.py model llama3.2
python scripts/lan.py ca
python scripts/lan.py check
```

Replace the example IP with the actual static private IPv4 of the server.
On Linux/macOS, use `python3` where appropriate; on Windows, use
`py -3 scripts\\lan.py`. Existing installations **must not** run
`init` a second time; it refuses to overwrite credentials. Instead,
update your Compose deployment with `python scripts/lan.py up`, preserving
`.env.lan`, `lan-clients.txt`, Caddy CA and persistent Docker volumes.

## Administrator dashboard

From a device on the **trusted LAN**, open:

```text
https://192.168.1.50/hub/
```

Import the public Caddy root certificate on the administrator device,
verify its fingerprint, then sign in using the **primary**
`YAG_API_KEY` from the central machine's `.env.lan`. This secret
is only for administrators; do not send it to PCs or store it in
client applications. Hub's static dashboard stores the admin key only in
the current browser tab's sessionStorage.

The dashboard provides four live workspaces:

1. **Model inventory:** native Ollama `/api/tags` list, asynchronous
   `/api/pull` download jobs and `/api/delete` removal. Jobs currently
   retain only running/completed/failed state in memory; model weights
   remain in Ollama's persistent volume.
2. **Client registry:** create a per-device key, rename, enable/disable,
   change relative priority (0–2), set maximum parallel inference
   requests (1–8) or revoke. **New secrets appear only once**.
   SQLite stores SHA-256 hashes of cryptographically random keys, not the
   original secrets. Changes take effect for newly arriving requests
   without restarting the gateway.
3. **Extra nodes:** register up to 8 explicitly private IPv4 OpenAI
   endpoints and assign supported exact model IDs. Nodes can be disabled
   or deleted live. The scheduler routes matching Chat/Completions/
   Embeddings requests to the **least-busy eligible node**.
4. **Telemetry and backup:** scheduler active/waiting counts, CPU/RAM
   where visible to the container and loaded Ollama model allocation in
   VRAM; consistent SQLite backup download.

Legacy per-PC keys created by `lan_bootstrap.py` are imported into Hub
only on first initialization. Removing an imported key in the dashboard
does not reseed it after a restart. On the **central host only**, YAG's
original localhost port 8080 still accepts original environment keys;
keep that port loopback-only and restrict host login access. LAN requests
pass through Hub and honor live revocation.

## API routing and scheduling

LAN clients keep their existing OpenAI-compatible URL
`https://192.168.1.50/v1` and one individual API key. Standard Chat,
Completions, Embeddings, Responses and Anthropic Messages requests go
through Hub authentication and its bounded inference queue; the original
C17 backend remains available for protocol translation.

| Environment | Default | Purpose |
| --- | --- | --- |
| `HUB_MAX_ACTIVE` | `4` | Max concurrent admitted inference requests (1–32) |
| `HUB_MAX_QUEUE` | `16` | Max waiting requests (0–128) |
| `HUB_QUEUE_SECONDS` | `15` | Max wait before HTTP 429 (1–300) |
| `YAG_MAX_BODY_MB` | `8` in LAN, `1` standalone | Max request body (1–8 MiB) |
| `HUB_BACKUP_INTERVAL_HOURS` | `24` | Automatic local snapshots (0 disables) |
| `HUB_BACKUP_RETAIN` | `14` | Number of local snapshot files (1–60) |

The queue is global with per-device concurrency and relative priority
(2 first, 0 last). For equal priority, admission is FIFO; long-running
streams retain their slot until completion. If full, new requests receive
HTTP 429. This is **admission control**, not GPU-memory allocation,
token-rate scheduling or a distributed fault-tolerant task queue.
Operations already running when a client is revoked are not forcibly
terminated; **new** requests and queued requests are refused.

Additional node URLs require literal RFC1918 IPv4 and explicit port:
`http://192.168.1.60:11434/v1` or a trusted HTTPS private endpoint.
Hub does not resolve arbitrary user-supplied DNS names or follow redirects.
Node selection is by operator-declared model ID and current local in-flight
count; it is **not** automatic health-based GPU scheduling. No transparent
retry after timeouts or HTTP errors, avoiding duplicated agent side effects.
Provide firewall rules allowing only the central Hub server to access
each secondary model host. Prefer HTTPS/tunnels between machines.

## Multimodal status

Chat Completions continues to pass OpenAI-compatible JSON **unchanged**,
including supported image content blocks or base64 images, now with a
configurable up-to-8-MiB body ceiling on the C gateway. Actual image
support depends on the chosen model and upstream Ollama version. This is
not native voice, image generation, file upload or universal multimodal
Responses/Anthropic translation: those protocol adaptations remain limited
and unsupported features are rejected, not fabricated.

## Security and admin API

All `/hub/api/*` endpoints require the primary administrator bearer
key. Device keys cannot manage models, clients, nodes or backups.

| Method | Endpoint | Action |
| --- | --- | --- |
| GET | `/hub/api/summary` | Scheduler, host-visible CPU/RAM, Ollama loaded-model VRAM |
| GET / POST | `/hub/api/clients` | List / create client; create returns key **once** |
| PATCH / DELETE | `/hub/api/clients/{id}` | Rename, disable/enable, set limits, revoke |
| GET / POST | `/hub/api/nodes` | List / register private node with model IDs |
| PATCH / DELETE | `/hub/api/nodes/{id}` | Edit / remove node |
| GET | `/hub/api/models` | Installed Ollama models |
| GET | `/hub/api/models/loaded` | Loaded Ollama models |
| POST | `/hub/api/models/pull` | Start asynchronous model pull |
| POST | `/hub/api/models/delete` | Delete an installed model |
| GET | `/hub/api/jobs` | Current model-management jobs |
| GET | `/hub/api/backup` | Download a consistent SQLite snapshot |

Caddy's TLS and the host firewall remain mandatory. No CORS credential
sharing is enabled. Never embed client/admin keys in a public JavaScript
bundle or forward router ports to the Internet. Administrators should use
a dedicated trusted device; browser session storage is not protected
from local malware or compromised extensions.

## Backups and updates

Hub automatically writes a consistent database snapshot on startup and
every 24 hours by default, rotating the latest 14 files under
`/data/backups` in the persistent **yag-hub-state Docker volume**.

**Same-volume snapshots are NOT a disaster-recovery backup.** To export
off-container via verified HTTPS and protect the resulting file with
owner-only permissions:

```sh
python scripts/lan.py backup --output-dir /path/to/encrypted/backup-drive
```

On Windows use an NTFS volume protected by appropriate ACLs and
preferably BitLocker; on Linux/macOS use an encrypted filesystem with
restrictive permissions. Backups include Hub configuration and hashes
of device keys, but not plaintext device keys, model weights or the
Caddy private CA signing key. To preserve full service identity, **also
back up the separate Caddy and Ollama volumes** using your platform's
approved encrypted backup mechanism. Backups containing API metadata
are sensitive and must not be committed to Git.

The update command is explicit:

```sh
python scripts/lan.py update
```

It pulls third-party container images and rebuilds/restarts Hub and YAG
from the checked-out repository version. Review and pin image versions,
back up state first, and schedule updates during a maintenance window.
No secret-bearing Docker socket is mounted into Hub.

For unattended **backup exports**, register the CLI as a host-side
scheduled task after configuring secure access to the CA and a private
backup destination:

- **Linux cron:** `15 3 * * * /usr/bin/python3 /srv/yag/scripts/lan.py backup --output-dir /secure/backups`
- **Windows Task Scheduler:** run `py -3 C:\\yag\\scripts\\lan.py backup --output-dir D:\\SecureBackups` daily under the account that owns the key files.
- **macOS launchd:** run `python3 /path/to/yag/scripts/lan.py backup --output-dir /Volumes/SecureBackup` at a configured daily time.

Use your platform's scheduler for **reviewed periodic updates** as well,
but do not auto-deploy unreviewed model/runtime changes without rollback
and compatibility monitoring. Restoring the snapshot requires stopping
the stack and replacing the Hub DB in its data volume; restore the Caddy
CA and Ollama volume separately. Do not run `docker compose down -v`.

## What is still not production-complete

GPU percentage/temperature and power draw are **not** reported; the
dashboard shows Ollama's per-loaded-model `size_vram` values. The
Linux `/proc` CPU/RAM view may represent the Docker VM on Windows/macOS,
rather than the physical host. Full GPU/VRAM monitoring requires a
platform-specific exporter with deliberately restricted permissions.

There is no distributed failover, tenant isolation beyond API keys,
identity provider, mTLS, unattended model rollback, general agent tool
execution, live model-capability verification, multimodal Anthropic
translation or HA control-plane replicas. Secondary nodes must already
run compatible model APIs and declare model IDs manually.
