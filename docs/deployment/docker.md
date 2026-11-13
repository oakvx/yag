# Docker / Compose: localhost-only pilot deployment

The container builds both the C17 gateway and the Console in separate stages.
The runtime image uses an unprivileged UID, a read-only root filesystem, no
Linux capabilities, and exposes the service only via an explicit loopback
port mapping in Compose. **YAG itself still serves unencrypted HTTP.**

```sh
export YAG_API_KEY="$(openssl rand -hex 32)"
# If your backend is on the Docker host, it must be reachable from Docker,
# not solely bound to the host's 127.0.0.1.
export YAG_UPSTREAM_URL='http://host.docker.internal:8000/v1'
docker compose build
docker compose up -d
curl http://127.0.0.1:8080/health
docker compose logs --no-color yag
```

To connect to an inference container on the same Docker network, configure
`YAG_UPSTREAM_URL` with its service DNS name and `/v1` suffix instead.
Never embed upstream credentials in the Compose file. Use a restricted
environment, orchestrator secret facility, or private service manager.

Compose binds `127.0.0.1:8080:8080`, **not** public port 8080. Any remote
access still requires a trusted TLS reverse proxy, access controls and firewall.

The image includes an HTTP healthcheck and does not require root privileges.
Run `docker compose down` to stop it. YAG drains active connections on SIGTERM;
Docker's default stop grace period may be too short for a long-running upstream.
For long generations use `docker compose stop -t 130`, or set a sufficiently
large `stop_grace_period` based on your actual runtime timeout.

A Docker image build validates packaging, **not** model performance or
production network security.

## HTTP client compatibility

The listener requires canonical HTTP/1.x request lines (method, target and
version separated by single ASCII spaces). It does not accept duplicate or
empty Host headers, control characters in header values, or conflicting
Authorization and X-API-Key headers. Set the bearer key using a single
Authorization header when using standard OpenAI-compatible clients.
