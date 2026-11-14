#!/usr/bin/env python3
"""Offline tagged-release integrity and safe Host rollback staging regression tests."""
import hashlib
import io
from pathlib import Path
import os
import stat
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from release_verify import main, stage_host, verify_release, expected_assets

TAG = "v0.2.0"


def host_archive(entries=None):
    if entries is None:
        entries = [
            ("yag", b"fake native host", tarfile.REGTYPE),
            ("RUNTIME.txt", b"Host runtime instructions", tarfile.REGTYPE),
            ("console/dist/index.html", b"<html>console</html>", tarfile.REGTYPE),
        ]
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        for name, payload, type_ in entries:
            info = tarfile.TarInfo(name)
            info.type = type_
            info.size = len(payload) if type_ == tarfile.REGTYPE else 0
            if type_ == tarfile.SYMTYPE:
                info.linkname = "yag"
            archive.addfile(info, io.BytesIO(payload) if info.size else None)
    return output.getvalue()


class ReleaseRecoveryTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.release = self.root / "release"
        self.release.mkdir()
        self.write_release()

    def write_release(self, archive=None):
        archive = archive if archive is not None else host_archive()
        payloads = {
            "yag-linux-x86_64.tar.gz": archive,
            f"yag-desktop-{TAG}-linux.deb": b"deb fixture",
            f"yag-desktop-{TAG}-windows.exe": b"exe fixture",
            f"yag-desktop-{TAG}-macos.dmg": b"dmg fixture",
        }
        lines = []
        for name, contents in sorted(payloads.items()):
            (self.release / name).write_bytes(contents)
            lines.append(hashlib.sha256(contents).hexdigest() + "  " + name)
        (self.release / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n", encoding="ascii")

    def test_full_release_verifies_and_stages_to_private_directory(self):
        self.assertEqual(set(verify_release(self.release, TAG)), expected_assets(TAG))
        target = self.root / "recovery-v0.2.0"
        self.assertEqual(stage_host(self.release, TAG, target), target)
        self.assertEqual((target / "yag").read_bytes(), b"fake native host")
        self.assertEqual((target / "console/dist/index.html").read_bytes(), b"<html>console</html>")
        if os.name != "nt":
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE((target / "yag").stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE((target / "RUNTIME.txt").stat().st_mode), 0o600)
        with self.assertRaisesRegex(ValueError, "already exists"):
            stage_host(self.release, TAG, target)

    def test_detects_tampered_payload_and_does_not_create_stage(self):
        with (self.release / "yag-linux-x86_64.tar.gz").open("ab") as f:
            f.write(b"tampered")
        with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
            stage_host(self.release, TAG, self.root / "not-created")
        self.assertFalse((self.root / "not-created").exists())

    def test_detects_missing_duplicate_and_extra_manifest_entries(self):
        manifest = self.release / "SHA256SUMS.txt"
        original = manifest.read_text()
        for bad in [
            original + original.splitlines()[0] + "\n",
            "\n".join(original.splitlines()[:-1]) + "\n",
            original.replace("yag-desktop-", "../yag-desktop-", 1),
            original.replace("  yag-", " *yag-", 1),
        ]:
            with self.subTest(bad=bad[-65:]):
                manifest.write_text(bad)
                with self.assertRaises(ValueError):
                    verify_release(self.release, TAG)
        manifest.write_text(original)

    def test_refuses_symlinked_assets_and_manifest(self):
        original = self.release / "yag-linux-x86_64.tar.gz"
        replacement = self.release / "copy.tar.gz"
        replacement.write_bytes(original.read_bytes())
        original.unlink()
        try:
            original.symlink_to(replacement)
        except (OSError, NotImplementedError):
            self.skipTest("Symlinks unsupported")
        with self.assertRaisesRegex(ValueError, "symlink"):
            verify_release(self.release, TAG)

    def test_rejects_archive_traversal_and_links_before_staging(self):
        mandatory = [
            ("yag", b"host", tarfile.REGTYPE),
            ("RUNTIME.txt", b"text", tarfile.REGTYPE),
            ("console/dist/index.html", b"html", tarfile.REGTYPE),
        ]
        unsafe = [
            ("../outside", b"bad", tarfile.REGTYPE),
            ("/absolute", b"bad", tarfile.REGTYPE),
            ("a/../../escape", b"bad", tarfile.REGTYPE),
            ("link", b"", tarfile.SYMTYPE),
            ("yag", b"duplicate", tarfile.REGTYPE),
        ]
        for entry in unsafe:
            with self.subTest(entry=entry[0]):
                self.write_release(host_archive(mandatory + [entry]))
                target = self.root / "not-created"
                with self.assertRaises(ValueError):
                    stage_host(self.release, TAG, target)
                self.assertFalse(target.exists())
                self.assertFalse((self.root / "outside").exists())

    def test_rejects_incomplete_host_archive(self):
        self.write_release(host_archive([("yag", b"host", tarfile.REGTYPE)]))
        with self.assertRaisesRegex(ValueError, "mandatory"):
            stage_host(self.release, TAG, self.root / "not-created")

    def test_refuses_untrusted_tag_and_world_writable_stage_parent(self):
        with self.assertRaises(ValueError):
            verify_release(self.release, "v1.2.3/../../other")
        if os.name != "nt":
            parent = self.root / "shared"
            parent.mkdir()
            parent.chmod(0o777)
            with self.assertRaisesRegex(ValueError, "not writable by others"):
                stage_host(self.release, TAG, parent / "new")

    def test_cli_verification_is_read_only(self):
        self.assertEqual(main(["--release-dir", str(self.release), "--tag", TAG]), 0)
        self.assertFalse((self.root / "rollback").exists())


if __name__ == "__main__":
    unittest.main()
