#!/usr/bin/env python3
"""End-to-end Hub control plane tests with deterministic HTTP mock backends."""
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "hub"))
from runtime import Ollama, Telemetry
from scheduler import Busy, Scheduler
from server import Handler, LimitedThreadServer
from storage import Storage, private_node_url

ADMIN = "admin-password-123456789"
LEGACY = "legacy-client-key-1234567"


class MockYAG(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass

    def answer(self, status, data):
        raw = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer " + ADMIN:
            return self.answer(401, {"error": "bad key"})
        if self.path == "/v1/models":
            return self.answer(200, {"object": "list", "data": [{"id": "mock-model"}]})
        return self.answer(200, {"ok": True})

    def do_POST(self):
        if self.headers.get("Authorization") != "Bearer " + ADMIN:
            return self.answer(401, {"error": "bad key"})
        length = int(self.headers.get("Content-Length", 0))
        payload = json.loads(self.rfile.read(length))
        return self.answer(200, {"object": "chat.completion", "request": payload,
                                 "choices": [{"message": {"content": "mock response"}}]})


class MockOllama(MockYAG):
    def do_GET(self):
        if self.path == "/api/tags":
            return self.answer(200, {"models": [{"name": "llama3.2", "size": 1024}]})
        if self.path == "/api/ps":
            return self.answer(200, {"models": [{"name": "llama3.2", "size_vram": 512}]})
        return self.answer(404, {})

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path == "/api/pull" and data.get("model") == "llama3.2":
            return self.answer(200, {"status": "success"})
        return self.answer(400, {"error": "unsupported"})

    def do_DELETE(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        return self.answer(200, {})


def req(port, method, path, body=None, secret=ADMIN):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=6)
    headers = {}
    if secret is not None:
        headers["Authorization"] = "Bearer " + secret
    if body is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(body)
    elif method in ("PATCH", "POST", "DELETE"):
        body = ""
    conn.request(method, path, body, headers)
    response = conn.getresponse()
    raw = response.read()
    result = (response.status, raw)
    conn.close()
    return result


class HubControlTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workdir = tempfile.TemporaryDirectory()
        cls.backend = ThreadingHTTPServer(("127.0.0.1", 0), MockYAG)
        cls.ollama_backend = ThreadingHTTPServer(("127.0.0.1", 0), MockOllama)
        for service in (cls.backend, cls.ollama_backend):
            service.daemon_threads = True
            threading.Thread(target=service.serve_forever, daemon=True).start()
        Handler.state = Storage(Path(cls.workdir.name) / "hub.sqlite3", LEGACY,
                                "inference+models")
        Handler.scheduler = Scheduler(2, 8, 0.25)
        Handler.ollama = Ollama("http://127.0.0.1:" + str(cls.ollama_backend.server_port))
        Handler.telemetry = Telemetry()
        Handler.admin_key = ADMIN
        Handler.yag_url = "http://127.0.0.1:" + str(cls.backend.server_port)
        cls.hub = LimitedThreadServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.hub.serve_forever, daemon=True).start()
        cls.port = cls.hub.server_port

    @classmethod
    def tearDownClass(cls):
        for service in (cls.hub, cls.backend, cls.ollama_backend):
            service.shutdown()
            service.server_close()
        cls.workdir.cleanup()

    def test_dashboard_is_static_and_no_client_secrets_exposed(self):
        status, page = req(self.port, "GET", "/hub/", secret=None)
        self.assertEqual(status, 200)
        self.assertIn(b"AI Datacenter", page)
        self.assertNotIn(LEGACY.encode(), page)
        status, _ = req(self.port, "GET", "/hub/api/clients", secret=None)
        self.assertEqual(status, 401)
        status, _ = req(self.port, "GET", "/hub/api/clients", secret=LEGACY)
        self.assertEqual(status, 403)

    def test_client_lifecycle_without_gateway_restart(self):
        status, raw = req(self.port, "GET", "/hub/api/clients")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["data"][0]["name"], "pc-01")
        self.assertNotIn(LEGACY.encode(), raw)
        status, raw = req(self.port, "POST", "/hub/api/clients", {"name": "laptop-office"})
        self.assertEqual(status, 201)
        created = json.loads(raw)
        self.assertGreaterEqual(len(created["key"]), 32)
        client_id = created["id"]
        client_key = created["key"]
        status, _ = req(self.port, "POST", "/v1/chat/completions",
                        {"model": "mock-model", "messages": []}, secret=client_key)
        self.assertEqual(status, 200)
        status, raw = req(self.port, "GET", "/hub/api/clients")
        self.assertNotIn(client_key.encode(), raw)
        status, _ = req(self.port, "PATCH", "/hub/api/clients/" + str(client_id),
                        {"name": "laptop-new", "enabled": False})
        self.assertEqual(status, 200)
        self.assertEqual(req(self.port, "GET", "/v1/models", secret=client_key)[0], 401)
        self.assertEqual(req(self.port, "PATCH", "/hub/api/clients/" + str(client_id),
                             {"enabled": True})[0], 200)
        self.assertEqual(req(self.port, "GET", "/v1/models", secret=client_key)[0], 200)
        self.assertEqual(req(self.port, "DELETE", "/hub/api/clients/" + str(client_id))[0], 200)
        self.assertEqual(req(self.port, "GET", "/v1/models", secret=client_key)[0], 401)

    def test_scopes_and_inference(self):
        self.assertEqual(req(self.port, "GET", "/v1/models", secret=LEGACY)[0], 200)
        self.assertEqual(req(self.port, "GET", "/api/metrics", secret=LEGACY)[0], 403)
        status, data = req(self.port, "POST", "/v1/chat/completions",
                           {"model": "mock-model", "messages": [{"role": "user", "content": "hello"}]},
                           secret=LEGACY)
        self.assertEqual(status, 200, data)
        self.assertEqual(json.loads(data)["request"]["messages"][0]["content"], "hello")
        self.assertEqual(req(self.port, "POST", "/v1/chat/completions",
                             {"model": "/etc/passwd"}, secret=LEGACY)[0], 400)
        self.assertEqual(req(self.port, "GET", "/api/status")[0], 200)

    def test_ollama_model_management(self):
        status, body = req(self.port, "GET", "/hub/api/models")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["models"][0]["name"], "llama3.2")
        status, body = req(self.port, "GET", "/hub/api/summary")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["hardware"]["ollama_size_vram_bytes"], 512)
        self.assertEqual(req(self.port, "POST", "/hub/api/models/delete", {"model": "llama3.2"})[0], 200)
        status, body = req(self.port, "POST", "/hub/api/models/pull", {"model": "llama3.2"})
        self.assertEqual(status, 202)
        for _ in range(40):
            jobs = json.loads(req(self.port, "GET", "/hub/api/jobs")[1])["data"]
            if jobs and jobs[-1]["status"] != "running":
                break
            time.sleep(0.02)
        self.assertEqual(jobs[-1]["status"], "complete")

    def test_nodes_and_url_policy(self):
        for bad in ("http://169.254.169.254:80/v1", "http://8.8.8.8:11434/v1",
                    "http://example.com:11434/v1", "file:///etc/passwd",
                    "http://127.0.0.1:11434/v1", "http://192.168.1.3:11434/admin"):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    private_node_url(bad)
        url = "http://192.168.1.60:11434/v1"
        status, body = req(self.port, "POST", "/hub/api/nodes",
                           {"name": "node-a", "url": url, "models": ["model-a"]})
        self.assertEqual(status, 201, body)
        identity = json.loads(body)["id"]
        self.assertEqual(req(self.port, "GET", "/hub/api/nodes")[0], 200)
        self.assertEqual(req(self.port, "PATCH", "/hub/api/nodes/" + str(identity),
                             {"enabled": False})[0], 200)
        self.assertEqual(req(self.port, "DELETE", "/hub/api/nodes/" + str(identity))[0], 200)

    def test_admin_backup_is_valid_sqlite_and_secured(self):
        status, backup = req(self.port, "GET", "/hub/api/backup")
        self.assertEqual(status, 200)
        self.assertTrue(backup.startswith(b"SQLite format 3"))
        self.assertEqual(req(self.port, "GET", "/hub/api/backup", secret=LEGACY)[0], 403)

    def test_scheduler_bounded_concurrency(self):
        schedule = Scheduler(1, 0, 0.1)
        ready = threading.Event()
        finish = threading.Event()

        def first():
            with schedule.slot(1, 1, 1):
                ready.set()
                finish.wait(2)

        thread = threading.Thread(target=first)
        thread.start()
        self.assertTrue(ready.wait(2))
        try:
            with self.assertRaises(Busy):
                with schedule.slot(2, 1, 1):
                    pass
            self.assertEqual(schedule.snapshot()["active"], 1)
        finally:
            finish.set()
            thread.join(timeout=2)
        self.assertEqual(schedule.snapshot()["active"], 0)


if __name__ == "__main__":
    unittest.main()
