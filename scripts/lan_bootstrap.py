#!/usr/bin/env python3
"""Generate an isolated, private-LAN YAG deployment with per-client API keys.

This command never prints secrets or overwrites existing credentials.
Requires only Python 3.9+ (standard library).
"""
import argparse
import csv
import io
import ipaddress
import os
from pathlib import Path
import secrets
import re
import subprocess
import sys

RFC1918 = tuple(ipaddress.ip_network(cidr) for cidr in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))


def private_lan_ipv4(value):
    try:
        address = ipaddress.ip_address(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Expected a private IPv4 address") from exc
    if not isinstance(address, ipaddress.IPv4Address) or not any(
        address in network for network in RFC1918
    ):
        raise argparse.ArgumentTypeError("Use a private RFC1918 IPv4 address on Colibri")
    if address.is_multicast or address.is_unspecified:
        raise argparse.ArgumentTypeError("Not a usable LAN host address")
    return str(address)


def client_count(value):
    try:
        count = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Expected a number from 1 to 16") from exc
    if not 1 <= count <= 16:
        raise argparse.ArgumentTypeError("YAG supports 1 to 16 additional client keys")
    return count


def secure_windows_acl(path):
    """Limit generated secret files to the invoking Windows user.

    Windows ignores POSIX 0600 permissions. Resolve the user SID instead
    of relying on localized account/group names. Fail closed if ACL
    hardening is unavailable.
    """
    user = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"],
                          capture_output=True, text=True, check=True)
    rows = list(csv.reader(io.StringIO(user.stdout)))
    if len(rows) != 1 or len(rows[0]) < 2:
        raise OSError("Unable to identify the current Windows user SID")
    sid = rows[0][1].strip()
    if not re.fullmatch(r"S-1-(?:[0-9]+-)+[0-9]+", sid):
        raise OSError("Invalid Windows user SID")
    acl = subprocess.run(["icacls", str(path), "/inheritance:r",
                          "/grant:r", "*" + sid + ":(F)"],
                         capture_output=True, text=True, check=False)
    if acl.returncode:
        raise OSError("Unable to secure Windows ACL for generated credentials")


def write_private(path, content):
    """Exclusive creation; restrict generated secrets to their owner."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as output:
            output.write(content)
        if os.name == "nt":
            secure_windows_acl(path)
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lan-ip", type=private_lan_ipv4, required=True,
                        help="Static/private IPv4 assigned to the central machine")
    parser.add_argument("--clients", type=client_count, default=3,
                        help="Number of separate client keys (1..16, default 3)")
    parser.add_argument("--managed-ollama", action="store_true",
                        help="Ollama runs in compose.lan.ollama.yaml (no exposed port)")
    parser.add_argument("--output-dir", type=Path, default=Path("."),
                        help="Directory for private credentials (default current dir)")
    args = parser.parse_args(argv)

    destination = args.output_dir.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    env_path = destination / ".env.lan"
    client_path = destination / "lan-clients.txt"
    if env_path.exists() or client_path.exists() or env_path.is_symlink() or client_path.is_symlink():
        parser.error("LAN credentials already exist; refusing to overwrite or rotate them")

    primary = secrets.token_urlsafe(48)
    keys = [secrets.token_urlsafe(32) for _ in range(args.clients)]
    scopes = ["inference+models"] * args.clients
    upstream = ("http://ollama:11434/v1" if args.managed_ollama
                else "http://host.docker.internal:11434/v1")
    env_content = (
        "# Sensitive credentials. Do not commit or send this file.\n"
        f"YAG_LAN_IP={args.lan_ip}\n"
        f"YAG_API_KEY={primary}\n"
        f"YAG_EXTRA_API_KEYS={','.join(keys)}\n"
        f"YAG_EXTRA_KEY_SCOPES={','.join(scopes)}\n"
        "YAG_RATE_LIMIT_PER_MINUTE=120\n"
        f"YAG_UPSTREAM_URL={upstream}\n"
    )
    client_content = (
        "# SENSITIVE: share ONE key with each client, not the entire file.\n"
        "# Import the LAN root CA certificate on each client before connecting.\n"
        f"Base URL: https://{args.lan_ip}/v1\n"
        "Scope: inference+models (no monitoring or admin access)\n\n"
        + "".join(f"pc-{i:02d}: {key}\n" for i, key in enumerate(keys, 1))
    )
    created = []
    try:
        for path, content in ((env_path, env_content), (client_path, client_content)):
            write_private(path, content)
            created.append(path)
    except OSError:
        for path in created:
            path.unlink(missing_ok=True)
        raise

    print(f"Created {env_path} and {client_path}.")
    print(f"Gateway URL: https://{args.lan_ip}/v1")
    print("Credentials were NOT printed. Share one client key per PC.")
    print("Next: follow docs/deployment/lan-hub.md for Compose and TLS trust.")
    if not args.managed_ollama:
        print("Existing Ollama must be reachable from the YAG container on port 11434.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
