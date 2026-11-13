"""Ollama model operations, Linux/container telemetry and upstream HTTP helpers."""
import http.client
import json
import os
from pathlib import Path
import ssl
import threading
import time
from urllib.parse import urlsplit


MAX_RESPONSE = 4 * 1024 * 1024


class UpstreamFailure(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def call_json(url, method="GET", payload=None, timeout=8, headers=None):
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise UpstreamFailure(400, "invalid upstream address")
    connector = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    conn = connector(parsed.hostname, parsed.port, timeout=timeout)
    raw = json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None
    request_headers = {"Connection": "close", **(headers or {})}
    if raw is not None:
        request_headers["Content-Type"] = "application/json"
    try:
        conn.request(method, parsed.path or "/", body=raw, headers=request_headers)
        response = conn.getresponse()
        body = response.read(MAX_RESPONSE + 1)
        if len(body) > MAX_RESPONSE:
            raise UpstreamFailure(502, "upstream response exceeds size limit")
        try:
            data = json.loads(body) if body else {}
        except (ValueError, UnicodeError) as exc:
            raise UpstreamFailure(502, "invalid upstream JSON") from exc
        if response.status >= 400:
            raise UpstreamFailure(response.status, str(data.get("error", "upstream request failed"))[:256])
        return data
    except (OSError, TimeoutError) as exc:
        raise UpstreamFailure(502, "upstream unavailable: " + type(exc).__name__) from exc
    finally:
        conn.close()


class Ollama:
    """Expose only fixed native Ollama paths; never accept arbitrary URLs from clients."""
    def __init__(self, base_url):
        self.base_url = base_url.rstrip("/") if base_url else ""
        self.lock = threading.Lock()
        self.jobs = {}
        self.sequence = 0
        self.pull_busy = False

    def ready(self):
        return bool(self.base_url)

    def native(self, path, method="GET", payload=None, timeout=8):
        if not self.ready():
            raise UpstreamFailure(503, "Ollama management is not configured")
        if path not in ("/api/tags", "/api/ps", "/api/pull", "/api/delete"):
            raise UpstreamFailure(400, "unsupported Ollama management operation")
        return call_json(self.base_url + path, method, payload, timeout)

    def models(self):
        return self.native("/api/tags")

    def loaded(self):
        return self.native("/api/ps")

    def delete(self, name):
        return self.native("/api/delete", "DELETE", {"model": name}, timeout=30)

    def pull(self, name):
        with self.lock:
            if self.pull_busy:
                raise UpstreamFailure(409, "another model download is running")
            self.sequence += 1
            identity = str(self.sequence)
            self.jobs = {key: value for key, value in self.jobs.items()
                         if int(key) > self.sequence - 16}
            self.jobs[identity] = {"id": identity, "model": name, "status": "running",
                                   "started": int(time.time())}
            self.pull_busy = True

        def worker():
            try:
                self.native("/api/pull", "POST", {"model": name, "stream": False}, timeout=3600)
                status, message = "complete", ""
            except Exception as exc:
                status, message = "failed", str(exc)[:180]
            with self.lock:
                self.jobs[identity].update(status=status, error=message,
                                           finished=int(time.time()))
                self.pull_busy = False

        thread = threading.Thread(target=worker, name="ollama-model-pull", daemon=True)
        thread.start()
        return identity

    def job_list(self):
        with self.lock:
            return list(self.jobs.values())


class Telemetry:
    def __init__(self):
        self.prev_cpu = None
        self.lock = threading.Lock()

    @staticmethod
    def _read_proc():
        cpu = None
        mem = {}
        try:
            for line in Path("/proc/stat").read_text().splitlines()[:1]:
                fields = line.split()
                if fields and fields[0] == "cpu":
                    values = [int(n) for n in fields[1:]]
                    cpu = (sum(values), values[3] + (values[4] if len(values) > 4 else 0))
        except (OSError, ValueError):
            pass
        try:
            for line in Path("/proc/meminfo").read_text().splitlines():
                if line.startswith(("MemTotal:", "MemAvailable:")):
                    label, value, *_ = line.split()
                    mem[label[:-1]] = int(value) * 1024
        except (OSError, ValueError):
            pass
        return cpu, mem

    def sample(self, ollama):
        cpu, mem = self._read_proc()
        with self.lock:
            percent = None
            if cpu and self.prev_cpu:
                total = cpu[0] - self.prev_cpu[0]
                idle = cpu[1] - self.prev_cpu[1]
                if total > 0:
                    percent = max(0, min(100, round(100*(1-idle/total), 1)))
            if cpu:
                self.prev_cpu = cpu
        hardware = {
            "scope": "container-host-visible", "cpu_percent": percent,
            "memory_total_bytes": mem.get("MemTotal"),
            "memory_available_bytes": mem.get("MemAvailable"),
            "gpu_percent": None, "gpu_percent_available": False,
            "loaded_models": [], "ollama_size_vram_bytes": 0,
        }
        try:
            data = ollama.loaded()
            models = data.get("models", [])
            if isinstance(models, list):
                hardware["loaded_models"] = [
                    {"name": str(model.get("name", ""))[:256],
                     "size_vram": int(model.get("size_vram") or 0)}
                    for model in models[:64] if isinstance(model, dict)]
                hardware["ollama_size_vram_bytes"] = sum(
                    model["size_vram"] for model in hardware["loaded_models"])
        except UpstreamFailure:
            hardware["ollama_unavailable"] = True
        return hardware
