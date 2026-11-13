# Optional administrative audit trail

YAG supports an **opt-in, local, append-only JSON Lines file** for administrative
HTTP responses. It is **off by default** and is not a request-history service.

## Enable on the central LAN deployment

Set this value in the private `.env.lan` file before `lan.py up`:

```dotenv
YAG_ADMIN_AUDIT_FILE=/opt/yag/state/admin-audit.jsonl
```

The path is inside the existing private `yag-state` Docker volume. A
standalone Linux deployment may choose another absolute location owned by
the YAG runtime user. The gateway refuses relative paths, symlinks, hardlinks,
nonregular files, files not owned by the runtime user and files accessible by
group/other users. New files are created with permission mode 0600.

Each entry contains only a Unix timestamp, fixed administrative resource
category (`clients`, `ollama` or `other`), request method
(`GET`, `POST` or `OTHER`) and final response status. For example:

```json
{"ts_unix":1794574800,"event":"admin_http_response","resource":"clients","method":"POST","status":201}
```

No API key, request body, prompt, model name, client name, IP address, upstream
URL or response content is written. Both unsuccessful authentication attempts
against recognized administrative paths and authorized requests can produce
entries. The event indicates that YAG **attempted** to issue that HTTP
response; it does not prove that a remote client received it.

## Limits and operations

- A single append is attempted per administrative HTTP response. Interrupted
  writes are retried; storage failures are reported to stderr but do not
  silently change API semantics or block an in-flight operation.
- File creation is checked at startup. File permissions should also be
  monitored operationally. This is not a tamper-evident log: a privileged
  host operator may still modify or delete its contents.
- Audit events are not exported by the monitoring API or sent to a remote
  telemetry provider. Backups of the private LAN configuration do not
  automatically include this file; manage retention, copying and rotation
  outside YAG.
- Rotate only with a controlled service restart or a log management system
  capable of handling a process that holds an open file descriptor.
- An independent security assessment and full identity system remain
  necessary for a production deployment on an untrusted network.
