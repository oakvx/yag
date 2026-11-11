# Docker deployment

YAG is an HTTP gateway. The image is unprivileged and contains its C17
server plus built React console. Docker Compose publishes only to
the Docker host's 127.0.0.1, not the public network.

## Start

```sh
export YAG_API_KEY="$(openssl rand -hex 32)"
# Replace with a reachable OpenAI-compatible backend. Host-local inference:
export YAG_UPSTREAM_URL="http://host.docker.internal:8000/v1"
docker compose up --build -d
curl -fsS http://127.0.0.1:8080/health
```

The upstream must listen on an interface reachable from the Docker bridge.
A backend bound only to the host's 127.0.0.1 typically cannot be reached via
host.docker.internal. Configure the backend's bind address securely and
apply host firewall rules, or use a private Docker Compose network.

To check logs: `docker compose logs -f yag`.
To stop: `docker compose down`; the gateway drains active workers on SIGTERM.

## Security boundaries

The Compose file drops Linux capabilities, enables a read-only filesystem
and avoids exposing 8080 on non-loopback host interfaces. **Traffic is still
unencrypted HTTP.** If access is needed from other machines, use a trusted
TLS reverse proxy with an access policy and firewall, not a raw public port.
Protect your API key and backend secret outside source control.

Neither the image nor a passing mock CLI test certifies support for a specific
inference model. Validate real tools, streaming and reasoning against your
chosen provider before production use.
