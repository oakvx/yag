# AI Control Plane — implementation and security boundaries

YAG's central-LAN deployment includes an optional operator control plane.
All management routes use the gateway's primary administrator key. Caddy
explicitly blocks `/api/admin/*` from the LAN HTTPS listener; open the
Console on the central machine at `http://127.0.0.1:8080`.

**Do not share the administrator key with client PCs.** Scope-restricted
client keys cannot install or delete models or issue/revoke credentials.

## 1. Ollama models

Configure `YAG_OLLAMA_ADMIN_URL` to the explicitly trusted **Ollama native**
API origin, such as `http://ollama:11434` for managed Compose or
`http://host.docker.internal:11434` for local host Ollama. No user-supplied
URL is accepted by the model-management endpoints.

| Local admin endpoint | Method | Action |
| --- | --- | --- |
| `/api/admin/ollama/models` | GET | List installed models through Ollama `/api/tags` |
| `/api/admin/ollama/loaded` | GET | List loaded models and Ollama-reported `size_vram` through `/api/ps` |
| `/api/admin/ollama/pull` | POST | Submit `{"name":"model:tag"}` for asynchronous pull/update |
| `/api/admin/ollama/jobs` | GET | Poll the latest pull job (`idle/running/completed/failed`) |
| `/api/admin/ollama/delete` | POST | Submit `{"name":"model:tag"}` to delete the exact model |

Model names are restricted to a short, allowlisted character set. At most
one pull/update job runs at a time; attempts to delete during a pull are
rejected. Work is cancelled during gateway shutdown. Job progress reports
status, **not** invented download percentages or GPU utilization. Running
model deletion/pulls depend on the Ollama runtime's behavior.

In the Console's **Control** page, select an installed model to use it in
the existing Playground, or enter a model ID to install/update it. Model
selection affects the current Console chat session, not a global override
for other clients.

## 2. Dynamic client keys

Set `YAG_CLIENT_STORE=/opt/yag/state/clients.json` in the central
deployment. A dedicated Docker volume persists these credentials and
the gateway process runs as a non-root UID. Storage is created with
owner-only file permissions, and writes use same-directory atomic rename.

| Local admin endpoint | Method | Action |
| --- | --- | --- |
| `/api/admin/clients` | GET | List client IDs, names, scopes, enabled flags, usage counts — never keys |
| `/api/admin/clients` | POST | Issue a key: `{"name":"Studio PC","scope":"inference+models"}` |
| `/api/admin/clients/rename` | POST | Rename: `{"id":4,"name":"Office PC"}` |
| `/api/admin/clients/disable` | POST | Disable immediately: `{"id":4}` |
| `/api/admin/clients/enable` | POST | Re-enable a disabled existing key |
| `/api/admin/clients/revoke` | POST | Permanently revoke a managed key; disable a static bootstrap key |

A new secret is cryptographically generated and returned **once only** in
the creation response. It cannot be retrieved again. Managed keys have
one of `inference`, `models`, `inference+models` or `monitor`
scopes, not the all-powerful administrative scope. Static bootstrap keys
remain in `.env.lan`; disabling them does not remove their original
secrets from that file. To completely retire a compromised static
credential, also rotate the secret in `.env.lan` and redeploy.

Revocation affects **new authentications immediately**. Requests already
admitted may finish. The registry supports up to 16 extra keys total,
including initial bootstrap keys. Its state is persistent, but activity
counters remain in memory and reset at restart.

Treat the Docker volume as a secret store. Backup archives include key
material and therefore **must be encrypted**.

## 3. Resource telemetry

`GET /api/system/resources` exposes Linux gateway-container cgroup v2
memory use/limit and /proc load averages when available. It **does not**
claim host-wide memory readings. `GET /api/admin/ollama/loaded` supplies
Ollama-reported per-loaded-model `size_vram`; its sum is not total VRAM
capacity or GPU utilization. A dedicated hardware exporter will be
required for accurate NVIDIA/AMD/Apple GPU and host-wide metrics.

## 4. FIFO inference scheduler

Configure these for a shared LAN:

| Variable | LAN default | Description |
| --- | --- | --- |
| `YAG_MAX_INFERENCE` | `6` | Maximum concurrent accepted inference requests |
| `YAG_MAX_INFERENCE_PER_KEY` | `2` | Maximum in-flight requests using one API key |
| `YAG_INFERENCE_QUEUE_WAIT_MS` | `15000` | FIFO wait deadline; queue hard-capped at 24 |
| `YAG_MAX_BODY_BYTES` | `4194304` | Per-request JSON body limit; global cap 8 MiB |

The standalone host defaults to scheduling disabled, to preserve existing
semantics. The LAN overlay enables it. Requests remain queued in bounded
workers. On capacity timeout or queue overflow, YAG returns HTTP 429
with a one-second Retry-After hint. The scheduler accounts for streaming
until the request ends, and uses bounded concurrency rather than pretending
to reserve model-specific GPU VRAM.

`GET /api/scheduler` reports active/waiting, caps and configured wait.

## 5. Multiple inference servers

`YAG_UPSTREAM_POOL` is an optional JSON array of up to 8 additional
OpenAI-compatible URLs and optional `key_env` references. The default
upstream is always a candidate; pool selection uses least concurrent
requests and a passive 30-second cooldown after two backend failures.
It does not duplicate requests after timeouts or HTTP responses.

A replica may optionally declare an explicit `models` allowlist of 1–32
model IDs. Only requests whose model ID exactly matches that list are
eligible for that replica; the default upstream always remains eligible.
Replicas without an allowlist retain the previous assumption of equivalent
inventories. **Operators must still verify that identical model IDs have
compatible API semantics.** YAG does not automatically discover a replica's
model inventory, dynamically merge it into `/v1/models`, or migrate a
running request. Static per-model routes take precedence over the pool.
`GET /api/providers/pool` exposes declared model names and health counters,
but never URLs, backend secrets or client credentials.

From the **central machine**:

```sh
python scripts/lan.py providers add --url http://colibri2:11434/v1 --model llama3.2 --model qwen2.5
python scripts/lan.py providers list
python scripts/lan.py up            # apply the updated configuration
python scripts/lan.py providers remove --url http://colibri2:11434/v1
```

For a replica that requires authentication, add a nonempty secret
`YAG_POOL_KEY_1` ... `YAG_POOL_KEY_8` to the private `.env.lan`
and reference it with `--key-env YAG_POOL_KEY_1`. The key passes to YAG
through Compose environment, not through JSON or an API response. Pool
changes currently require redeployment via `lan.py up`; no unsafe
hot-editing of live libcurl destination pointers is provided.

### Resource telemetry caveats

`GET /api/system/resources` retains cgroup v2 RAM usage and limits.
Linux `/proc/stat` CPU utilization is calculated between successive reads
(the first sample has no percentage); load average is separate. Host-visible
RAM total and available bytes are read from `/proc/meminfo` and explicitly
labeled `proc_meminfo`: in containers these values may represent the host,
not the gateway memory limit. For supported Linux DRM drivers, `gpu.devices`
reports only counters exposed by `/sys/class/drm/card*/device/` and hwmon
(usage, VRAM used/total, temperature). NVIDIA systems that require NVML,
Windows, macOS and unmounted sysfs typically return an empty device list.
Missing sensors are not interpreted as zero or inferred from Ollama's model
allocation. API responses do not disclose GPU device nodes, upstream URLs or
private keys.

## 6. Images, speech and bounded multimodal passthrough

Besides OpenAI-compatible Chat (including upstream-supported image_url
inputs), YAG forwards:

- `POST /v1/images/generations`: JSON image prompt and model to an
  OpenAI-compatible image backend.
- `POST /v1/audio/speech`: JSON model, input and voice to a speech
  backend; returns the upstream binary content type and bytes.
- `POST /v1/embeddings`: vector generation through an installed
  embedding model.

These are **transparent upstream adapters, not local image/audio models**.
Ollama installations may not implement image generation or TTS endpoints;
choose another backend with the required API and route by model ID.
Inbound multipart uploads, OpenAI transcription, Responses/Anthropic image
translation and fully featured vision preprocessing are **not implemented**.
Large base64 images are subject to the 8 MiB absolute incoming request cap.

## 7. Encrypted backups and controlled updates

Run the lifecycle CLI on the central server, *outside* the YAG container:

```sh
# Install the age tool separately and generate an age identity offline.
# Supply the corresponding PUBLIC age1... recipient; keep its secret off-server.
python scripts/lan.py backup --recipient age1YOUR_PUBLIC_RECIPIENT
python scripts/lan.py update
```

The encrypted `.tar.gz.age` snapshot includes `.env.lan`, the bootstrap
client list, local root CA public certificate, and available runtime
client registry plus Caddy CA key/certificate material. Files are collected
on the central host, placed in a private temporary archive, encrypted with
age, and only the encrypted output is retained. **Backups do not include
Ollama model weights**. Export those separately from their Docker volume
when a full inference-server restore is required, and verify restores on
an isolated host before relying on them.

Updates pull the Caddy image (and managed Ollama image, if enabled) and
rebuild YAG from the locally checked-out repository. They preserve named
volumes; they **do not automatically fetch unreviewed Git commits** or
delete model data. A production rollout should snapshot configuration,
review upstream release notes and plan rollback. There is no guaranteed
automatic rollback after image or schema changes.

To schedule backup without a persistent privileged server endpoint,
configure the host operating system's scheduler:

- Linux: add a daily cron entry invoking the full path to
  `python3 /path/to/yag/scripts/lan.py backup --recipient age1...`
  with its working directory set to the repo.
- Windows: configure Task Scheduler to execute
  `py -3 C:\\path\\to\\yag\\scripts\\lan.py backup --recipient age1...`
  under the account with Docker access and with the repository as
  the working directory.
- macOS: use a user/administrator launchd job for the same command.

Never send API keys, archive contents or the age identity private key to
remote telemetry/backup services without a separate access and encryption
policy. A backup is only useful after a verified restore.
