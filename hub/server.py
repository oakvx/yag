#!/usr/bin/env python3
"""YAG LAN Hub control plane: scoped clients, scheduling and Ollama fleet.

Runs only on the private Compose network behind the existing Caddy HTTPS proxy.
The legacy C gateway remains the backend for protocol translation.
"""
import hmac
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import socket
import socketserver
import sqlite3
import ssl
import threading
from urllib.parse import urlsplit

from runtime import Ollama, Telemetry, UpstreamFailure, call_json
from scheduler import Busy, Scheduler
from storage import MODEL, Storage

BODY_LIMIT = 8 * 1024 * 1024
INFERENCE = frozenset((
    "/v1/chat/completions", "/v1/completions", "/v1/embeddings",
    "/v1/responses", "/v1/messages"))
DIRECT_NODE = frozenset((
    "/v1/chat/completions", "/v1/completions", "/v1/embeddings"))
ADMIN_MONITOR = frozenset((
    "/api/status", "/api/metrics", "/api/clients", "/api/routes",
    "/api/capabilities", "/api/models/capabilities", "/api/providers/status",
    "/api/provider/check"))
STATIC = {
    "/hub/": ("index.html", "text/html; charset=utf-8"),
    "/hub/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/hub/style.css": ("style.css", "text/css; charset=utf-8"),
}


def port_number(value, default, lower=1, upper=65535):
    number = int(value or default)
    if not lower <= number <= upper:
        raise ValueError("out-of-range numeric configuration")
    return number


class LimitedThreadServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64

    def __init__(self, addr, handler):
        super().__init__(addr, handler)
        self.limit = threading.BoundedSemaphore(64)

    def process_request(self, request, client_address):
        if not self.limit.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.limit.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.limit.release()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "YAG-Hub"
    sys_version = ""
    state = None
    scheduler = None
    ollama = None
    telemetry = None
    admin_key = ""
    yag_url = "http://yag:8080"
    asset_root = Path(__file__).resolve().parent / "static"

    def log_message(self, format_string, *args):
        # Never log raw paths, Authorization headers, prompts or model arguments.
        pass

    def _send(self, status, payload, content_type="application/json", headers=None):
        data = (json.dumps(payload, separators=(",", ":")).encode("utf-8")
                if content_type == "application/json" else payload)
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        if headers:
            for key, value in headers.items():
                self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(data)
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _error(self, status, message):
        self._send(status, {"error": {"message": message[:256]}})

    def _body(self, limit=BODY_LIMIT):
        values = self.headers.get_all("Content-Length", [])
        if len(values) != 1 or not values[0].isdigit():
            raise ValueError("Content-Length is required")
        amount = int(values[0])
        if not 0 <= amount <= limit:
            raise ValueError("request body exceeds configured limit")
        if self.headers.get("Transfer-Encoding"):
            raise ValueError("chunked request bodies are not supported")
        raw = self.rfile.read(amount)
        if len(raw) != amount:
            raise ValueError("incomplete request body")
        return raw

    def _json(self, limit=65536):
        raw = self._body(limit)
        try:
            value = json.loads(raw)
        except (ValueError, UnicodeError) as exc:
            raise ValueError("invalid JSON body") from exc
        if not isinstance(value, dict):
            raise ValueError("expected a JSON object")
        return value

    def _principal(self):
        auth = self.headers.get_all("Authorization", [])
        if len(auth) != 1 or not auth[0].startswith("Bearer ") or len(auth[0]) > 530:
            return None
        token = auth[0][7:]
        if hmac.compare_digest(token, self.admin_key):
            return {"id": 0, "name": "admin", "priority": 2,
                    "max_parallel": 8, "scope": "all", "admin": True}
        client = self.state.authenticate(token)
        return dict(client, admin=False) if client else None

    @staticmethod
    def _allowed(principal, scope):
        if not principal:
            return False
        permissions = principal["scope"]
        if permissions == "all":
            return True
        return scope == "inference" and permissions in ("inference", "inference+models") or (
            scope == "models" and permissions in ("models", "inference+models")) or (
            scope == "monitor" and permissions == "monitor")

    def _route(self, method):
        # Never accept arbitrary query strings on administrative endpoints.
        path = self.path
        if "?" in path or "#" in path:
            self._error(400, "query parameters not supported by LAN Hub")
            return
        if path == "/health" and method == "GET":
            self._send(200, {"status": "ok", "service": "yag-hub"})
            return
        if method == "GET" and path in STATIC:
            asset, mime = STATIC[path]
            self._send(200, (self.asset_root / asset).read_bytes(), mime,
                       {"Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'"}
                       if asset == "index.html" else None)
            return
        if path.startswith("/hub/api/"):
            principal = self._principal()
            if not principal:
                self._error(401, "invalid API key")
            elif not principal["admin"]:
                self._error(403, "hub administration requires the primary key")
            else:
                self._admin(method, path)
            return
        if path.startswith("/v1/") or path.startswith("/api/"):
            principal = self._principal()
            if not principal:
                self._error(401, "invalid API key")
                return
            if path.startswith("/api/"):
                if not self._allowed(principal, "monitor") or (
                        path == "/api/provider/check" and not principal["admin"]):
                    self._error(403, "insufficient API key scope")
                elif path not in ADMIN_MONITOR:
                    self._error(404, "endpoint unavailable")
                elif method not in (("POST",) if path == "/api/provider/check" else ("GET",)):
                    self._error(405, "method not allowed")
                else:
                    self._proxy(self.yag_url + path, method, principal, use_admin_key=True)
                return
            if path == "/v1/models" or path.startswith("/v1/models/"):
                if method != "GET":
                    self._error(405, "method not allowed")
                elif not self._allowed(principal, "models"):
                    self._error(403, "model discovery not permitted")
                elif path == "/v1/models":
                    self._models()
                else:
                    self._proxy(self.yag_url + path, method, principal, use_admin_key=True)
                return
            if path not in INFERENCE and path != "/v1/messages/count_tokens":
                self._error(404, "unsupported inference endpoint")
                return
            if not self._allowed(principal, "inference"):
                self._error(403, "inference not permitted")
                return
            if method != "POST":
                self._error(405, "method not allowed")
                return
            self._inference(path, principal)
            return
        self._error(404, "not found")

    def _models(self):
        try:
            response = call_json(self.yag_url + "/v1/models", headers={
                "Authorization": "Bearer " + self.admin_key})
            items = response.get("data", [])
            if not isinstance(items, list):
                items = []
            known = {m.get("id") for m in items if isinstance(m, dict)}
            for node in self.state.list_nodes():
                if node["enabled"]:
                    for model in node["models"]:
                        if model not in known:
                            items.append({"id": model, "object": "model", "owned_by": node["name"]})
                            known.add(model)
            self._send(200, {"object": "list", "data": items[:256]})
        except UpstreamFailure as exc:
            self._error(exc.status, str(exc))

    def _proxy(self, url, method, principal, use_admin_key=False, body=None):
        parsed = urlsplit(url)
        connection_type = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
        conn = connection_type(parsed.hostname, parsed.port, timeout=120)
        headers = {
            "Content-Type": "application/json",
            "Connection": "close",
            "Accept": "text/event-stream, application/json",
        }
        if use_admin_key:
            headers["Authorization"] = "Bearer " + self.admin_key
        if body is None and method == "POST":
            body = self._body()
        try:
            conn.request(method, parsed.path, body=body, headers=headers)
            upstream = conn.getresponse()
            # No upstream hop-by-hop headers; let connection close frame SSE.
            self.send_response(upstream.status)
            self.send_header("Content-Type", upstream.getheader("Content-Type", "application/json"))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            while True:
                block = upstream.read1(16384)
                if not block:
                    break
                self.wfile.write(block)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return
        except (OSError, TimeoutError):
            if not self.close_connection:
                self._error(502, "upstream unavailable")
            self.close_connection = True
        finally:
            conn.close()

    def _inference(self, path, principal):
        try:
            raw = self._body()
            value = json.loads(raw)
            model = value.get("model") if isinstance(value, dict) else None
            if not isinstance(model, str) or not MODEL.fullmatch(model):
                raise ValueError("inference requests require a valid model")
        except (ValueError, UnicodeError) as exc:
            self._error(400, str(exc))
            return
        try:
            with self.scheduler.slot(principal["id"], principal["priority"],
                                     principal["max_parallel"]):
                # A revoked key must not acquire an inference slot while queued.
                if not principal["admin"] and not self.state.is_enabled(principal["id"]):
                    self._error(403, "client access revoked")
                    return
                node = self.scheduler.choose_node(self.state.list_nodes(), model) if path in DIRECT_NODE else None
                try:
                    target = (node["url"] + path[3:] if node else self.yag_url + path)
                    self._proxy(target, "POST", principal, use_admin_key=not node, body=raw)
                finally:
                    if node:
                        self.scheduler.release_node(node["id"])
                if not principal["admin"]:
                    self.state.usage(principal["id"], True)
        except Busy as exc:
            if not principal["admin"]:
                self.state.usage(principal["id"], False)
            self._send(429, {"error": {"message": str(exc)}}, headers={"Retry-After": "5"})

    def _admin(self, method, path):
        try:
            if path == "/hub/api/summary" and method == "GET":
                self._send(200, {"scheduler": self.scheduler.snapshot(),
                                 "hardware": self.telemetry.sample(self.ollama),
                                 "managed_ollama": self.ollama.ready()})
                return
            if path == "/hub/api/clients":
                if method == "GET":
                    self._send(200, {"data": self.state.list_clients()})
                elif method == "POST":
                    data = self._json()
                    self._send(201, self.state.create_client(
                        data.get("name"), data.get("priority", 1), data.get("max_parallel", 2)))
                else:
                    self._error(405, "method not allowed")
                return
            if path.startswith("/hub/api/clients/"):
                identity = self._identity(path, "/hub/api/clients/")
                if method == "PATCH":
                    ok = self.state.update_client(identity, self._json())
                elif method == "DELETE":
                    ok = self.state.revoke_client(identity)
                else:
                    return self._error(405, "method not allowed")
                return self._send(200 if ok else 404, {"ok": ok})
            if path == "/hub/api/nodes":
                if method == "GET":
                    self._send(200, {"data": self.state.list_nodes()})
                elif method == "POST":
                    data = self._json()
                    identity = self.state.add_node(
                        data.get("name"), data.get("url"), data.get("models"))
                    self._send(201, {"id": identity})
                else:
                    self._error(405, "method not allowed")
                return
            if path.startswith("/hub/api/nodes/"):
                identity = self._identity(path, "/hub/api/nodes/")
                if method == "DELETE":
                    ok = self.state.delete_node(identity)
                elif method == "PATCH":
                    ok = self.state.update_node(identity, self._json())
                else:
                    return self._error(405, "method not allowed")
                return self._send(200 if ok else 404, {"ok": ok})
            if path == "/hub/api/models" and method == "GET":
                self._send(200, self.ollama.models())
                return
            if path == "/hub/api/models/loaded" and method == "GET":
                self._send(200, self.ollama.loaded())
                return
            if path == "/hub/api/models/pull" and method == "POST":
                name = self._json().get("model")
                if not isinstance(name, str) or not MODEL.fullmatch(name):
                    raise ValueError("invalid model name")
                if not self.ollama.ready():
                    raise UpstreamFailure(503, "Ollama management not configured")
                self._send(202, {"job": self.ollama.pull(name)})
                return
            if path == "/hub/api/models/delete" and method == "POST":
                name = self._json().get("model")
                if not isinstance(name, str) or not MODEL.fullmatch(name):
                    raise ValueError("invalid model name")
                self._send(200, {"ok": True, "result": self.ollama.delete(name)})
                return
            if path == "/hub/api/jobs" and method == "GET":
                self._send(200, {"data": self.ollama.job_list()})
                return
            if path == "/hub/api/backup" and method == "GET":
                raw = self.state.backup()
                self._send(200, raw, "application/vnd.sqlite3",
                           {"Content-Disposition": 'attachment; filename="yag-hub-backup.sqlite3"'})
                return
            self._error(404, "unknown hub operation")
        except ValueError as exc:
            self._error(400, str(exc))
        except sqlite3.IntegrityError:
            self._error(409, "a client or node with this name already exists")
        except UpstreamFailure as exc:
            self._error(exc.status, str(exc))

    @staticmethod
    def _identity(path, prefix):
        value = path[len(prefix):]
        if not re.fullmatch(r"[1-9][0-9]{0,7}", value):
            raise ValueError("invalid registry item ID")
        return int(value)

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_PATCH(self):
        self._route("PATCH")

    def do_DELETE(self):
        self._route("DELETE")

    def do_OPTIONS(self):
        # No browser cross-origin credential sharing.
        self._error(405, "CORS is disabled")


def main():
    key = os.environ.get("HUB_ADMIN_KEY", "")
    if len(key) < 16:
        raise SystemExit("HUB_ADMIN_KEY of at least 16 characters is required")
    Handler.admin_key = key
    Handler.yag_url = os.environ.get("HUB_YAG_URL", "http://yag:8080").rstrip("/")
    Handler.state = Storage(os.environ.get("HUB_DB", "/data/hub.sqlite3"),
                            os.environ.get("YAG_EXTRA_API_KEYS", ""),
                            os.environ.get("YAG_EXTRA_KEY_SCOPES", ""))
    Handler.scheduler = Scheduler(
        port_number(os.environ.get("HUB_MAX_ACTIVE"), 4, upper=32),
        port_number(os.environ.get("HUB_MAX_QUEUE"), 16, lower=0, upper=128),
        port_number(os.environ.get("HUB_QUEUE_SECONDS"), 15, upper=300))
    Handler.ollama = Ollama(os.environ.get("HUB_OLLAMA_URL", ""))
    Handler.telemetry = Telemetry()
    interval_hours = port_number(os.environ.get("HUB_BACKUP_INTERVAL_HOURS"), 24, lower=0, upper=720)
    keep = port_number(os.environ.get("HUB_BACKUP_RETAIN"), 14, upper=60)
    if interval_hours:
        def automatic_backup():
            while True:
                try:
                    Handler.state.archive_snapshot("/data/backups", keep)
                except (OSError, ValueError, sqlite3.Error) as exc:
                    # Only the error type is logged, never sensitive DB content.
                    print("Hub backup failed:", type(exc).__name__, flush=True)
                threading.Event().wait(interval_hours * 3600)
        threading.Thread(target=automatic_backup, name="hub-backup", daemon=True).start()
    port = port_number(os.environ.get("HUB_PORT"), 8081)
    server = LimitedThreadServer(("0.0.0.0", port), Handler)
    print("YAG Hub listening on private container port", port, flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
