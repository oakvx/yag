#!/usr/bin/env python3
"""Private LAN operations: replica pool configuration and encrypted snapshots.

Platform-independent Python standard library. Uses the external age CLI for
backup encryption; never emits an unencrypted backup artifact to the caller.
"""
import datetime
import io
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
from urllib.parse import urlsplit

from lan_bootstrap import secure_windows_acl


def validate_backend(url):
    if not url or len(url) > 1024 or any(ord(c) < 33 for c in url):
        raise ValueError("Invalid backend URL")
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or (
        parsed.username or parsed.password or parsed.query or parsed.fragment
        or parsed.path != "/v1" or url.endswith("/")):
        raise ValueError("Expected HTTP(S) OpenAI-compatible URL ending in /v1")
    if parsed.port is not None and not 1 <= parsed.port <= 65535:
        raise ValueError("Invalid port")
    if parsed.scheme == "http":
        hostname = parsed.hostname.lower()
        try:
            address = ipaddress.ip_address(hostname)
            if not address.is_private:
                raise ValueError("Unencrypted upstream must use a private IP")
        except ValueError as exc:
            if isinstance(exc, ValueError) and str(exc).startswith("Unencrypted"):
                raise
            if hostname != "localhost" and hostname != "host.docker.internal" and (
                    "." in hostname and not hostname.endswith(".local")):
                raise ValueError("HTTP upstream hostname must be local to the LAN") from exc
    return url


def read_entries(path):
    text = path.read_text(encoding="utf-8")
    values = {}
    for line in text.splitlines():
        if line and not line.lstrip().startswith("#") and "=" in line:
            name, value = line.split("=", 1)
            values[name] = value
    return text, values


def secure_replace(path, content):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Cannot update missing or symlinked private LAN configuration")
    source = path.stat()
    if os.name != "nt" and (stat.S_IMODE(source.st_mode) & 0o077):
        raise ValueError("Refusing to update a LAN configuration readable by other users")
    fd, temp = tempfile.mkstemp(prefix=".yag-lan-", dir=str(path.parent))
    replacement = Path(temp)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        if os.name == "nt":
            secure_windows_acl(replacement)
        os.replace(replacement, path)
    finally:
        replacement.unlink(missing_ok=True)


def save_environment(path, name, value):
    text, _ = read_entries(path)
    lines = text.splitlines()
    found = 0
    for index, line in enumerate(lines):
        if line.startswith(name + "="):
            lines[index] = name + "=" + value
            found += 1
    if found > 1:
        raise ValueError("Duplicate environment variable")
    if not found:
        lines.append(name + "=" + value)
    secure_replace(path, "\n".join(lines) + "\n")


def read_pool(path):
    _, env = read_entries(path)
    raw = env.get("YAG_UPSTREAM_POOL", "[]")
    try:
        pool = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("YAG_UPSTREAM_POOL must be valid JSON") from exc
    if not isinstance(pool, list) or len(pool) > 8:
        raise ValueError("YAG_UPSTREAM_POOL must be a list of at most eight backends")
    for entry in pool:
        if not isinstance(entry, dict) or not isinstance(entry.get("url"), str):
            raise ValueError("Invalid pool entry")
        validate_backend(entry["url"])
    return pool


def configure_provider(path, action, url=None, key_env=None):
    pool = read_pool(path)
    if action == "list":
        for index, entry in enumerate(pool, 1):
            print(f"replica-{index}: {entry['url']}" +
                  (" (external key)" if entry.get("key_env") else ""))
        if not pool:
            print("No replicas configured. Default upstream remains active.")
        return
    validate_backend(url)
    _, env = read_entries(path)
    if action == "add":
        if len(pool) >= 8 or any(item["url"] == url for item in pool):
            raise ValueError("Replica pool full or backend already configured")
        entry = {"url": url}
        if key_env:
            if not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", key_env):
                raise ValueError("Invalid key environment name")
            if not env.get(key_env):
                raise ValueError("Configured key_env must exist in the private .env.lan")
            entry["key_env"] = key_env
        pool.append(entry)
    elif action == "remove":
        reduced = [item for item in pool if item["url"] != url]
        if len(reduced) == len(pool):
            raise ValueError("Backend is not in the configured pool")
        pool = reduced
    else:
        raise ValueError("Unsupported provider action")
    save_environment(path, "YAG_UPSTREAM_POOL",
                     json.dumps(pool, separators=(",", ":"), ensure_ascii=True))
    print("Replica configuration updated. Run 'python scripts/lan.py up' to apply.")


def private_archive(entries, target):
    with tarfile.open(target, "w:gz") as tar:
        for name, source in entries:
            if not source.is_file() or source.is_symlink():
                raise ValueError("Backup source must be a regular file: " + name)
            data = source.read_bytes()
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o600
            info.mtime = 0
            tar.addfile(info, io.BytesIO(data))


def encrypted_backup(root, config, compose_command, invoke, recipient, output_dir):
    if not re.fullmatch(r"age1[0-9a-z]{20,100}", recipient):
        raise ValueError("An age recipient public key is required for encrypted backups")
    if not shutil.which("age"):
        raise ValueError("Install the age CLI to enable encrypted backups")
    output_dir = Path(output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    when = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%M%S")
    target = output_dir / f"yag-lan-config-{when}.tar.gz.age"
    if target.exists():
        raise ValueError("Backup already exists")
    with tempfile.TemporaryDirectory(prefix="yag-backup-") as temp:
        folder = Path(temp)
        archive = folder / "snapshot.tar.gz"
        sources = []
        for filename in (".env.lan", "lan-clients.txt", "lan-root-ca.crt"):
            source = root / filename
            if source.exists():
                sources.append((filename, source))
        if not any(name == ".env.lan" for name, _ in sources):
            raise ValueError("No private LAN configuration to back up")
        remote = (
            ("runtime/clients.json",
             "yag:/opt/yag/state/clients.json"),
            ("caddy/root.crt",
             "caddy:/data/caddy/pki/authorities/local/root.crt"),
            ("caddy/root.key",
             "caddy:/data/caddy/pki/authorities/local/root.key"),
            ("caddy/intermediate.crt",
             "caddy:/data/caddy/pki/authorities/local/intermediate.crt"),
            ("caddy/intermediate.key",
             "caddy:/data/caddy/pki/authorities/local/intermediate.key"),
        )
        # Optional sources: a fresh server might have no registry or CA yet.
        for member, location in remote:
            local = folder / member.replace("/", "_")
            cmd = compose_command(config, "cp", location, str(local))
            response = invoke(cmd, capture=True)
            if response.returncode == 0 and local.is_file():
                sources.append((member, local))
        if not any(name.startswith("caddy/") for name, _ in sources):
            print("Warning: Caddy CA private key not included (service not initialized).")
        private_archive(sources, archive)
        # age encrypts to a new file; retain only the encrypted output.
        # Source archive exists only in a private temporary directory.
        result = subprocess.run(["age", "-r", recipient, "-o", str(target),
                                 str(archive)], capture_output=True,
                                text=True, check=False)
        if result.returncode:
            target.unlink(missing_ok=True)
            raise ValueError("age encryption failed: " + result.stderr.strip()[:200])
        if os.name != "nt":
            target.chmod(0o600)
        elif target.exists():
            secure_windows_acl(target)
    print("Encrypted configuration and CA backup created:", str(target))
    print("Model weights are NOT included; export Ollama's model volume separately.")
    print("Retain the age identity/private key outside the server for restoration.")
    return target
