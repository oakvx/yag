#!/usr/bin/env python3
"""Verify and stage age-encrypted LAN backups without touching live services.

The archive is treated as untrusted after successful age decryption. A fixed
allowlist, strict type/size checks, and exclusive writes prevent traversal,
links, accidental replacement, and silent partial restores.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

from lan_bootstrap import secure_windows_acl

ALLOWED_MEMBERS = frozenset({
    ".env.lan",
    "lan-clients.txt",
    "lan-root-ca.crt",
    "runtime/clients.json",
    "caddy/root.crt",
    "caddy/root.key",
    "caddy/intermediate.crt",
    "caddy/intermediate.key",
})
MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
MAX_MEMBER_BYTES = 4 * 1024 * 1024
MAX_TOTAL_BYTES = 16 * 1024 * 1024


def _regular_input(name, value):
    candidate = Path(value).expanduser()
    if candidate.is_symlink() or not candidate.is_file():
        raise ValueError(name + " must be an existing regular file (not a symlink)")
    if not candidate.stat().st_size:
        raise ValueError(name + " is empty")
    return candidate.resolve()


def _inspect_tar(plaintext):
    seen = {}
    total = 0
    try:
        with tarfile.open(plaintext, mode="r|gz") as archive:
            for member in archive:
                name = member.name
                if (name not in ALLOWED_MEMBERS or name in seen or
                        not member.isfile() or member.size < 0 or
                        member.size > MAX_MEMBER_BYTES):
                    raise ValueError("Backup has unexpected, duplicate or unsafe member")
                total += member.size
                if total > MAX_TOTAL_BYTES:
                    raise ValueError("Backup member sizes exceed the safe limit")
                stream = archive.extractfile(member)
                if stream is None:
                    raise ValueError("Cannot read a backup member")
                with stream:
                    data = stream.read(member.size + 1)
                if len(data) != member.size:
                    raise ValueError("Truncated or malformed backup member")
                seen[name] = data
                if len(seen) > len(ALLOWED_MEMBERS):
                    raise ValueError("Backup contains too many members")
    except (tarfile.TarError, EOFError, OSError) as exc:
        raise ValueError("Malformed decrypted TAR archive") from exc
    if ".env.lan" not in seen or b"YAG_API_KEY=" not in seen[".env.lan"] or (
            b"\\x00" in seen[".env.lan"]):
        raise ValueError("Backup lacks a valid private LAN configuration")
    return seen


def inspect_backup(archive_path, identity_path, output_dir=None):
    """Decrypt, inspect, and optionally stage a snapshot in a NEW private folder.

    Never writes to .env.lan, Docker volumes, or the running YAG installation.
    Only the newly created stage directory can receive cleartext output.
    """
    source = _regular_input("Encrypted archive", archive_path)
    identity = _regular_input("age identity", identity_path)
    if source.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("Encrypted archive exceeds the size limit")
    if not shutil.which("age"):
        raise ValueError("Install the age CLI to verify and stage backups")

    if output_dir is not None:
        destination = Path(output_dir).expanduser()
        if destination.exists() or destination.is_symlink():
            raise ValueError("Staging directory must not exist (no overwrites)")
        if not destination.parent.is_dir() or destination.parent.is_symlink():
            raise ValueError("Staging parent must be an existing real directory")
    else:
        destination = None

    with tempfile.TemporaryDirectory(prefix="yag-recovery-") as temp:
        plaintext = Path(temp) / "snapshot.tar.gz"
        try:
            response = subprocess.run(
                ["age", "--decrypt", "-i", str(identity), "-o", str(plaintext),
                 str(source)],
                capture_output=True, text=True, check=False, timeout=60)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ValueError("age failed or timed out decrypting backup") from exc
        if response.returncode:
            raise ValueError("age decryption failed; check identity and archive")
        if not plaintext.is_file() or plaintext.is_symlink() or (
                plaintext.stat().st_size > MAX_ARCHIVE_BYTES):
            raise ValueError("Decrypted archive is missing or too large")
        entries = _inspect_tar(plaintext)

    if destination is not None:
        destination.mkdir(mode=0o700)
        try:
            if os.name != "nt":
                destination.chmod(0o700)
            else:
                secure_windows_acl(destination)
            for name, data in sorted(entries.items()):
                path = destination / name
                path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with path.open("xb") as target:
                    target.write(data)
                    target.flush()
                    os.fsync(target.fileno())
                if os.name != "nt":
                    path.chmod(0o600)
                else:
                    secure_windows_acl(path)
        except Exception:
            shutil.rmtree(destination)
            raise

    for name in sorted(entries):
        print("Verified:", name, "(" + str(len(entries[name])) + " bytes)")
    if destination is not None:
        print("Private recovery files staged at:", destination)
        print("No live configuration or Docker volume was modified.")
        print("Restore the Caddy CA and runtime registry only during a planned shutdown.")
    else:
        print("Backup decrypted and validated. No cleartext files were retained.")
    if "caddy/root.key" not in entries or "caddy/intermediate.key" not in entries:
        print("Warning: complete private Caddy CA key material is not present.")
    print("Ollama model weights are not included in this archive.")
    return tuple(sorted(entries))
