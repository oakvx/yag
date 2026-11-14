#!/usr/bin/env python3
"""Verify tagged release digests and stage a Host rollback without touching live YAG.

SHA256SUMS is an integrity manifest, NOT proof of who published a release.
Verify GitHub Sigstore provenance independently before treating files as trusted.
"""
import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tarfile
import tempfile

TAG = re.compile(r"v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\Z")
LINE = re.compile(r"([0-9a-fA-F]{64})  ([a-zA-Z0-9._-]+)\Z")
MAX_ASSET_BYTES = 2 * 1024 * 1024 * 1024
MAX_TAR_MEMBERS = 5000
MAX_TAR_BYTES = 512 * 1024 * 1024
MAX_MEMBER_BYTES = 128 * 1024 * 1024
HOST_REQUIRED = frozenset(("yag", "RUNTIME.txt", "console/dist/index.html"))


def expected_assets(tag):
    if not TAG.fullmatch(tag):
        raise ValueError("Expected a reviewed semantic version tag, e.g. v0.2.0")
    return {
        "yag-linux-x86_64.tar.gz",
        f"yag-desktop-{tag}-linux.deb",
        f"yag-desktop-{tag}-windows.exe",
        f"yag-desktop-{tag}-macos.dmg",
    }


def _safe_file(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Missing, non-regular or symlink release file: " + path.name)
    if not 0 < path.stat().st_size <= MAX_ASSET_BYTES:
        raise ValueError("Release file size outside safety limit: " + path.name)


def verify_release(directory, tag):
    """Verify all four files against a strictly parsed, trusted manifest."""
    directory = Path(directory).expanduser()
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("Release directory must be a real directory")
    manifest = directory / "SHA256SUMS.txt"
    _safe_file(manifest)
    if manifest.stat().st_size > 4096:
        raise ValueError("Checksum manifest too large")
    try:
        lines = manifest.read_text(encoding="ascii").splitlines()
    except (UnicodeError, OSError) as exc:
        raise ValueError("Invalid checksum manifest encoding") from exc
    required = expected_assets(tag)
    if len(lines) != len(required):
        raise ValueError("Checksum manifest must list exactly four release assets")
    hashes = {}
    for line in lines:
        match = LINE.fullmatch(line)
        if not match or match[2] in hashes:
            raise ValueError("Malformed or duplicate checksum entry")
        hashes[match[2]] = match[1].lower()
    if set(hashes) != required:
        raise ValueError("Checksum manifest does not match expected tagged assets")
    for name, digest in sorted(hashes.items()):
        path = directory / name
        _safe_file(path)
        hasher = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                hasher.update(chunk)
        if hasher.hexdigest() != digest:
            raise ValueError("SHA-256 mismatch: " + name)
    return tuple(sorted(hashes))


def _safe_member(member):
    raw = member.name
    if not raw or raw.startswith("/") or "\\" in raw or "\x00" in raw:
        raise ValueError("Unsafe archive member path")
    parts = [part for part in raw.split("/") if part not in ("", ".")]
    if not parts and member.isdir():
        return None  # tar -C package -czf ... . writes a root directory entry
    if not parts or any(part == ".." or ":" in part for part in parts):
        raise ValueError("Unsafe archive member path")
    name = PurePosixPath(*parts).as_posix()
    if not (member.isfile() or member.isdir()):
        raise ValueError("Archive contains link, device or other unsafe member")
    return name


def stage_host(directory, tag, destination):
    """Stage verified Host files into a fresh private directory, never in place."""
    verify_release(directory, tag)
    target = Path(destination).expanduser()
    if target.exists() or target.is_symlink():
        raise ValueError("Rollback staging destination already exists")
    parent = target.parent
    if parent.is_symlink() or not parent.is_dir():
        raise ValueError("Rollback parent must be a real existing directory")
    info = parent.stat()
    if os.name != "nt" and (info.st_uid != os.geteuid() or info.st_mode & 0o022):
        raise ValueError("Rollback parent must be owned by the operator and not writable by others")
    archive_path = Path(directory).expanduser() / "yag-linux-x86_64.tar.gz"
    with tarfile.open(archive_path, mode="r:gz") as archive:
        members = archive.getmembers()
        if len(members) > MAX_TAR_MEMBERS:
            raise ValueError("Archive contains too many members")
        entries = {}
        files = set()
        size = 0
        for member in members:
            name = _safe_member(member)
            if name is None:
                continue
            if name in entries or member.size < 0 or member.size > MAX_MEMBER_BYTES:
                raise ValueError("Duplicate or oversized archive member")
            if member.isfile():
                size += member.size
                files.add(name)
            if size > MAX_TAR_BYTES:
                raise ValueError("Archive decompressed size exceeds safety limit")
            entries[name] = member
        if not HOST_REQUIRED <= files:
            raise ValueError("Host release archive is missing mandatory files")

        temporary = Path(tempfile.mkdtemp(prefix=".yag-rollback-", dir=parent))
        try:
            for name, member in sorted(entries.items(), key=lambda item: (item[0].count("/"), item[0])):
                path = temporary.joinpath(*PurePosixPath(name).parts)
                path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
                if member.isdir():
                    path.mkdir(mode=0o700, exist_ok=True)
                else:
                    stream = archive.extractfile(member)
                    if stream is None:
                        raise ValueError("Unreadable archive member")
                    with stream, path.open("xb") as output:
                        remaining = member.size
                        while remaining:
                            chunk = stream.read(min(1024 * 1024, remaining))
                            if not chunk:
                                raise ValueError("Truncated archive member")
                            output.write(chunk)
                            remaining -= len(chunk)
                        output.flush()
                        os.fsync(output.fileno())
                    if os.name != "nt":
                        path.chmod(0o700 if name == "yag" else 0o600)
            if target.exists() or target.is_symlink():
                raise ValueError("Rollback destination appeared during staging")
            temporary.rename(target)
        except Exception:
            shutil.rmtree(temporary)
            raise
    return target


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-dir", required=True, help="Directory with all four assets and SHA256SUMS.txt")
    parser.add_argument("--tag", required=True, help="Reviewed release tag, e.g. v0.2.0")
    parser.add_argument("--stage-host", help="New private directory for offline Host rollback staging")
    args = parser.parse_args(argv)
    try:
        assets = verify_release(args.release_dir, args.tag)
        print("SHA-256 verified:", ", ".join(assets))
        if args.stage_host:
            dest = stage_host(args.release_dir, args.tag, args.stage_host)
            print("Host rollback staged at:", dest)
            print("No live services, secrets, Ollama models or Docker volumes were changed.")
        print("Verify GitHub attestation identity separately before installing.")
        return 0
    except (ValueError, OSError, tarfile.TarError) as exc:
        print("Release verification/staging failed:", exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
