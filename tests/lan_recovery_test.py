#!/usr/bin/env python3
"""Offline age backup verification and non-overwriting recovery staging tests."""
import contextlib
import io
import os
from pathlib import Path
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
import lan_recovery


ENV = b"YAG_API_KEY=private-test-key-123456\nYAG_UPSTREAM_URL=http://localhost:11434/v1\n"


def package(parts):
    memory = io.BytesIO()
    with tarfile.open(fileobj=memory,mode="w:gz") as archive:
        for name, value, kind in parts:
            info=tarfile.TarInfo(name)
            info.type=kind
            info.mode=0o600
            data=value if kind==tarfile.REGTYPE else b""
            info.size=len(data)
            archive.addfile(info,io.BytesIO(data))
    return memory.getvalue()


class Recovery(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.archive=self.root/"snapshot.tar.gz.age"
        self.archive.write_bytes(b"mock-age-encrypted-payload")
        self.identity=self.root/"identity.txt"
        self.identity.write_bytes(b"AGE-SECRET-KEY-private-mock")
        self.payload=package([
            (".env.lan",ENV,tarfile.REGTYPE),
            ("lan-clients.txt",b"PC: secret-client-key",tarfile.REGTYPE),
            ("runtime/clients.json",b'{"clients":[]}',tarfile.REGTYPE),
        ])
        self.patch_age()

    def patch_age(self):
        def fake_run(command,**_kwargs):
            self.assertEqual(command[:2],["age","--decrypt"])
            target=Path(command[command.index("-o")+1])
            target.write_bytes(self.payload)
            return subprocess.CompletedProcess(command,0,"","")
        patch_which=mock.patch.object(lan_recovery.shutil,"which",return_value="/bin/age")
        patch_run=mock.patch.object(lan_recovery.subprocess,"run",side_effect=fake_run)
        patch_acl=mock.patch.object(lan_recovery,"secure_windows_acl")
        patch_which.start();patch_run.start();patch_acl.start()
        self.addCleanup(patch_which.stop)
        self.addCleanup(patch_run.stop)
        self.addCleanup(patch_acl.stop)

    def test_check_does_not_leave_cleartext(self):
        stdout=io.StringIO()
        with contextlib.redirect_stdout(stdout):
            names=lan_recovery.inspect_backup(self.archive,self.identity)
        self.assertIn(".env.lan",names)
        self.assertIn("runtime/clients.json",names)
        self.assertIn("No cleartext files were retained",stdout.getvalue())
        self.assertNotIn("private-test-key",stdout.getvalue())
        self.assertEqual(sorted(p.name for p in self.root.iterdir()),
                         ["identity.txt","snapshot.tar.gz.age"])

    def test_stage_creates_private_files_without_touching_live_config(self):
        live=self.root/".env.lan"
        live.write_bytes(b"YAG_API_KEY=LIVE_DO_NOT_REPLACE")
        destination=self.root/"staged-recovery"
        with contextlib.redirect_stdout(io.StringIO()):
            names=lan_recovery.inspect_backup(self.archive,self.identity,destination)
        self.assertIn(".env.lan",names)
        self.assertEqual((destination/".env.lan").read_bytes(),ENV)
        self.assertEqual(live.read_bytes(),b"YAG_API_KEY=LIVE_DO_NOT_REPLACE")
        self.assertEqual((destination/"runtime/clients.json").read_bytes(),
                         b'{"clients":[]}')
        if os.name!="nt":
            self.assertEqual(stat.S_IMODE(destination.stat().st_mode),0o700)
            self.assertEqual(stat.S_IMODE((destination/".env.lan").stat().st_mode),0o600)
        with self.assertRaisesRegex(ValueError,"must not exist"):
            lan_recovery.inspect_backup(self.archive,self.identity,destination)

    def test_rejects_unsafe_archive_members(self):
        samples=[
            [(".env.lan",ENV,tarfile.REGTYPE),
             ("../outside",b"traversal",tarfile.REGTYPE)],
            [(".env.lan",ENV,tarfile.REGTYPE),
             ("caddy/root.key",b"",tarfile.SYMTYPE)],
            [(".env.lan",ENV,tarfile.REGTYPE),
             (".env.lan",ENV,tarfile.REGTYPE)],
            [("lan-clients.txt",b"orphan",tarfile.REGTYPE)],
            [(".env.lan",b"missing-api-key",tarfile.REGTYPE)],
            [(".env.lan",ENV+bytes([0]),tarfile.REGTYPE)],
            [(".env.lan",ENV,tarfile.REGTYPE),
             ("runtime/clients.json",bytes(4*1024*1024+1),tarfile.REGTYPE)],
        ]
        for members in samples:
            with self.subTest(members=[x[0] for x in members]):
                self.payload=package(members)
                destination=self.root/"should-not-exist"
                with self.assertRaises(ValueError):
                    lan_recovery.inspect_backup(self.archive,self.identity,destination)
                self.assertFalse(destination.exists())

    def test_rejects_symlink_inputs(self):
        link=self.root/"archive-link.age"
        if not hasattr(os,"symlink"):
            self.skipTest("No symlink support")
        try:
            link.symlink_to(self.archive)
        except (OSError, NotImplementedError):
            self.skipTest("Symlink creation not permitted")
        with self.assertRaisesRegex(ValueError,"symlink"):
            lan_recovery.inspect_backup(link,self.identity)

    def test_rejects_missing_decryptor_and_missing_identity(self):
        with mock.patch.object(lan_recovery.shutil,"which",return_value=None):
            with self.assertRaisesRegex(ValueError,"Install the age CLI"):
                lan_recovery.inspect_backup(self.archive,self.identity)
        with self.assertRaisesRegex(ValueError,"age identity"):
            lan_recovery.inspect_backup(self.archive,self.root/"missing-identity")

    def test_cli_can_inspect_before_any_lan_config_exists(self):
        import lan
        with mock.patch.object(lan,"inspect_backup",return_value=()),contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(lan.main(["backup-check","--archive",str(self.archive),
                                       "--identity",str(self.identity)]),0)
            lan.inspect_backup.assert_called_once()


if __name__=="__main__":
    unittest.main()
