#!/usr/bin/env python3
"""Manage a YAG LAN AI hub on Windows, Linux or macOS (Python 3.9+).

Requires Docker Compose v2 for runtime commands. Never prints API keys or
Docker Compose's resolved environment; never changes host firewall settings.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import http.client
import ipaddress
import os
from pathlib import Path
import platform
import re
import shutil
import ssl
import subprocess
import sys

from lan_bootstrap import main as bootstrap_main, private_lan_ipv4, secure_windows_acl

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env.lan"
CA_PATH = ROOT / "lan-root-ca.crt"
MODEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$")
MANAGED_UPSTREAM = "http://ollama:11434/v1"


class SetupError(Exception):
    """An actionable deployment configuration or verification failure."""


def read_config():
    if not ENV_PATH.is_file():
        raise SetupError("Missing .env.lan: run 'python scripts/lan.py init --lan-ip PRIVATE_IP' first")
    settings = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        if line and not line.lstrip().startswith("#") and "=" in line:
            name, value = line.split("=", 1)
            settings[name.strip()] = value.strip()
    for key in ("YAG_LAN_IP", "YAG_API_KEY", "YAG_EXTRA_API_KEYS",
                "YAG_EXTRA_KEY_SCOPES", "YAG_UPSTREAM_URL"):
        if not settings.get(key):
            raise SetupError("Invalid .env.lan: missing " + key)
    try:
        private_lan_ipv4(settings["YAG_LAN_IP"])
    except argparse.ArgumentTypeError as exc:
        raise SetupError("Invalid YAG_LAN_IP: " + str(exc)) from exc
    if len(settings["YAG_EXTRA_API_KEYS"].split(",")) != len(
            settings["YAG_EXTRA_KEY_SCOPES"].split(",")):
        raise SetupError("Mismatched client keys and scopes in .env.lan")
    return settings


def managed(config):
    return config["YAG_UPSTREAM_URL"] == MANAGED_UPSTREAM


def docker_environment():
    # An exported host variable overrides Compose --env-file. Ensure that the
    # generated credentials and LAN address cannot be shadowed by the shell.
    environment = os.environ.copy()
    for name in list(environment):
        if name.startswith("YAG_") or name in (
                "COMPOSE_FILE", "COMPOSE_ENV_FILES", "COMPOSE_PROFILES"):
            del environment[name]
    return environment


def compose_command(config, *arguments):
    command = ["docker", "compose", "--env-file", str(ENV_PATH),
               "-f", str(ROOT / "compose.yaml"),
               "-f", str(ROOT / "compose.lan.yaml")]
    if managed(config):
        command.extend(["-f", str(ROOT / "compose.lan.ollama.yaml")])
    return command + list(arguments)


def invoke(command, *, capture=False):
    try:
        return subprocess.run(command, cwd=ROOT, env=docker_environment(),
                              capture_output=capture, text=True, check=False)
    except OSError as exc:
        raise SetupError("Unable to execute Docker: " + str(exc)) from exc


def require_docker(config):
    if not shutil.which("docker"):
        raise SetupError("Docker CLI not found. Install Docker Desktop or Docker Engine + Compose v2")
    for command, description in (
        (["docker", "compose", "version", "--short"], "Docker Compose v2"),
        (["docker", "info", "--format", "{{.ServerVersion}}"], "Docker daemon"),
        (compose_command(config, "config", "--quiet"), "LAN Compose configuration"),
    ):
        result = invoke(command, capture=True)
        if result.returncode:
            raise SetupError(description + " unavailable or invalid. Check Docker Desktop/Engine and Compose v2. "
                             + result.stderr.strip()[:350])
    return True


def doctor(config):
    print("Host:", platform.system(), platform.machine())
    print("LAN HTTPS address: https://" + config["YAG_LAN_IP"] + "/v1")
    print("Ollama:", "private Compose service" if managed(config) else
          "external/host backend (verify its reachability separately)")
    require_docker(config)
    print("Docker daemon, Compose v2 and LAN configuration: OK")
    print("Confirm this IP belongs to the host, TCP 443 is available and the")
    print("host firewall restricts access to trusted LAN clients; no WAN forwarding.")
    if platform.system() == "Darwin" and managed(config):
        print("macOS: Dockerized Ollama normally uses CPU; native Ollama can use Apple Metal.")
    if platform.system() == "Windows":
        print("Windows: use Docker Desktop Linux containers; verify Windows Firewall and NTFS ACLs.")


def https_status(config, path, key=None):
    ip = config["YAG_LAN_IP"]
    port_string = config.get("YAG_LAN_HTTPS_PORT", "443")
    try:
        port = int(port_string)
    except ValueError as exc:
        raise SetupError("Invalid YAG_LAN_HTTPS_PORT") from exc
    if not 1 <= port <= 65535:
        raise SetupError("Invalid YAG_LAN_HTTPS_PORT")
    if not CA_PATH.is_file():
        raise SetupError("Missing lan-root-ca.crt: run 'python scripts/lan.py ca' after 'up'")
    context = ssl.create_default_context(cafile=str(CA_PATH))
    connection = http.client.HTTPSConnection(ip, port, timeout=8, context=context)
    headers = {"Authorization": "Bearer " + key} if key else {}
    try:
        connection.request("GET", path, headers=headers)
        response = connection.getresponse()
        response.read(4096)
        return response.status
    finally:
        connection.close()


def verify(config):
    keys = config["YAG_EXTRA_API_KEYS"].split(",")
    checks = [
        ("/health", None, 200, "public health"),
        ("/v1/models", None, 401, "unauthenticated model discovery"),
        ("/api/clients", keys[0], 403, "client cannot monitor others"),
        ("/api/clients", config["YAG_API_KEY"], 200, "admin monitoring"),
    ]
    for path, key, expected, label in checks:
        try:
            status = https_status(config, path, key)
        except (OSError, ssl.SSLError) as exc:
            raise SetupError("HTTPS verification failed (" + label + "): " + str(exc)) from exc
        if status != expected:
            raise SetupError("Unexpected HTTP " + str(status) + " for " + label +
                             "; expected " + str(expected))
        print(label + ": HTTP " + str(status) + " OK")
    print("LAN HTTPS certificate and API key isolation: verified")


def export_ca(config):
    if CA_PATH.exists() or CA_PATH.is_symlink():
        raise SetupError("lan-root-ca.crt already exists; refusing to overwrite it")
    result = invoke(compose_command(config, "cp",
                                    "caddy:/data/caddy/pki/authorities/local/root.crt",
                                    "./lan-root-ca.crt"), capture=True)
    if result.returncode:
        raise SetupError("Cannot export Caddy root CA. Start the stack first. " +
                         result.stderr.strip()[:350])
    try:
        pem = CA_PATH.read_text(encoding="ascii")
        if "-----BEGIN CERTIFICATE-----" not in pem:
            raise ValueError("Not a PEM certificate")
        der = ssl.PEM_cert_to_DER_cert(pem)
    except (OSError, ValueError) as exc:
        CA_PATH.unlink(missing_ok=True)
        raise SetupError("Exported CA is invalid: " + str(exc)) from exc
    print("CA public certificate exported to", CA_PATH.name)
    print("SHA-256 fingerprint:", hashlib.sha256(der).hexdigest().upper())
    print("Verify this fingerprint out of band before trusting the CA on clients.")
    print("Never export or distribute Caddy's CA private key.")


def export_backup(config, destination):
    """Download a consistent control-plane snapshot over verified LAN HTTPS."""
    if not CA_PATH.is_file():
        raise SetupError("Missing public root CA: run 'python scripts/lan.py ca'")
    directory = Path(destination).resolve()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    ip = config["YAG_LAN_IP"]
    port = int(config.get("YAG_LAN_HTTPS_PORT", "443"))
    if not 1 <= port <= 65535:
        raise SetupError("Invalid HTTPS port")
    context = ssl.create_default_context(cafile=str(CA_PATH))
    connection = http.client.HTTPSConnection(ip, port, timeout=30, context=context)
    try:
        connection.request("GET", "/hub/api/backup", headers={
            "Authorization": "Bearer " + config["YAG_API_KEY"]})
        response = connection.getresponse()
        if response.status != 200:
            raise SetupError("Backup endpoint returned HTTP " + str(response.status))
        content = response.read(16*1024*1024+1)
        if len(content) > 16*1024*1024 or not content.startswith(b"SQLite format 3"):
            raise SetupError("Invalid or oversized SQLite snapshot")
    except (OSError, ssl.SSLError) as exc:
        raise SetupError("Cannot download verified backup: " + type(exc).__name__) from exc
    finally:
        connection.close()
    filename = datetime.now(timezone.utc).strftime("yag-hub-%Y%m%dT%H%M%SZ-") + hashlib.sha256(content).hexdigest()[:8] + ".sqlite3"
    target = directory / filename
    descriptor = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        if os.name == "nt":
            secure_windows_acl(target)
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    print("Verified, owner-only backup saved:", str(target))
    print("Store backups on independent encrypted storage for disaster recovery.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    initialize = actions.add_parser("init", help="Generate credentials (one time only)")
    initialize.add_argument("--lan-ip", required=True, help="Server's static RFC1918 IPv4")
    initialize.add_argument("--clients", type=int, default=3, help="1..16 client keys")
    initialize.add_argument("--managed-ollama", action="store_true",
                            help="Private Ollama container (recommended for new hosts)")
    for name, help_text in (
        ("doctor", "Check Docker daemon, Compose and LAN config"),
        ("up", "Start gateway and optional managed Ollama"),
        ("down", "Stop services without deleting models or CA"),
        ("status", "Show running containers"),
        ("ca", "Export Caddy's public CA certificate"),
        ("check", "Verify HTTPS and client authorization"),
    ):
        actions.add_parser(name, help=help_text)
    export = actions.add_parser("backup", help="Export Hub database over verified HTTPS")
    export.add_argument("--output-dir", type=Path, default=ROOT / "backups")
    actions.add_parser("update", help="Pull updated images and rebuild/restart the stack")
    models = actions.add_parser("model", help="Pull a model into managed Ollama")
    models.add_argument("model_id", help="e.g. llama3.2")
    args = parser.parse_args(argv)
    try:
        if args.action == "init":
            options = ["--lan-ip", args.lan_ip, "--clients", str(args.clients),
                       "--output-dir", str(ROOT)]
            if args.managed_ollama:
                options.append("--managed-ollama")
            return bootstrap_main(options)
        config = read_config()
        if args.action == "doctor":
            doctor(config)
            return 0
        if args.action == "check":
            verify(config)
            return 0
        if args.action == "ca":
            export_ca(config)
            return 0
        if args.action == "backup":
            export_backup(config, args.output_dir)
            return 0
        if args.action == "update":
            doctor(config)
            # Buildable YAG/Hub images remain local: update only vendor images.
            pulled = invoke(compose_command(config, "pull", "--ignore-buildable"))
            if pulled.returncode:
                raise SetupError("Vendor image update failed; previous containers are unchanged")
            return invoke(compose_command(config, "up", "-d", "--build")).returncode
        if args.action == "up":
            doctor(config)
            command = compose_command(config, "up", "--build", "-d")
        elif args.action == "down":
            command = compose_command(config, "down")
        elif args.action == "status":
            command = compose_command(config, "ps")
        elif args.action == "model":
            if not managed(config):
                raise SetupError("Model pull is only available with --managed-ollama")
            if not MODEL_PATTERN.fullmatch(args.model_id):
                raise SetupError("Invalid Ollama model ID")
            command = compose_command(config, "exec", "-T", "ollama", "ollama",
                                      "pull", args.model_id)
        else:
            raise SetupError("Unsupported action")
        return invoke(command).returncode
    except SetupError as exc:
        print("LAN setup error:", exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
