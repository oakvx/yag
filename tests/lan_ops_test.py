#!/usr/bin/env python3
"""Cross-platform tests for LAN replica config and encrypted backup contracts."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import lan_ops


def new_config(root):
    file = root / ".env.lan"
    file.write_text(
        "YAG_LAN_IP=192.168.1.50\n"
        "YAG_API_KEY=admin-secret-1234567890\n"
        "YAG_POOL_KEY_1=private-upstream-secret\n")
    if os.name != "nt":
        file.chmod(0o600)
    return file


class LanOperationsTest(unittest.TestCase):
    def test_validates_tls_and_private_lan_replica_hosts(self):
        for url in ("http://192.168.0.12:11434/v1",
                    "http://colibri:11434/v1",
                    "http://ollama.local:11434/v1",
                    "https://models.example.com/v1"):
            with self.subTest(url=url):
                self.assertEqual(lan_ops.validate_backend(url),url)
        for url in ("", "http://8.8.8.8:11434/v1",
                    "http://169.254.169.254/v1",
                    "http://user:pass@colibri/v1",
                    "http://host.example.com/v1",
                    "http://127.0.0.1:0/v1",
                    "http://colibri:abc/v1",
                    "https://models.example.com/v1?key=secret",
                    "http://colibri/api/chat", "file:///tmp/v1"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                lan_ops.validate_backend(url)

    def test_add_list_remove_replica_preserves_admin_secret(self):
        with tempfile.TemporaryDirectory() as temp:
            path=new_config(Path(temp))
            url="http://192.168.1.60:11434/v1"
            with contextlib.redirect_stdout(io.StringIO()):
                lan_ops.configure_provider(path,"add",url,"YAG_POOL_KEY_1")
            values=lan_ops.read_entries(path)[1]
            self.assertEqual(values["YAG_API_KEY"],"admin-secret-1234567890")
            self.assertEqual(json.loads(values["YAG_UPSTREAM_POOL"]),
                             [{"url":url,"key_env":"YAG_POOL_KEY_1"}])
            out=io.StringIO()
            with contextlib.redirect_stdout(out):
                lan_ops.configure_provider(path,"list")
            self.assertIn("replica-1",out.getvalue())
            self.assertNotIn("private-upstream-secret",out.getvalue())
            with self.assertRaises(ValueError):
                lan_ops.configure_provider(path,"add",url)
            with self.assertRaises(ValueError):
                lan_ops.configure_provider(path,"add","http://colibri/v1",
                                            "WRONG_KEY_VAR")
            with contextlib.redirect_stdout(io.StringIO()):
                lan_ops.configure_provider(path,"remove",url)
            self.assertEqual(lan_ops.read_pool(path),[])
            if os.name != "nt":
                self.assertEqual(path.stat().st_mode & 0o777,0o600)

    def test_replica_model_allowlist_roundtrip_and_validation(self):
        with tempfile.TemporaryDirectory() as temp:
            path=new_config(Path(temp))
            url="http://192.168.1.61:11434/v1"
            with contextlib.redirect_stdout(io.StringIO()):
                lan_ops.configure_provider(path,"add",url,models=["glm-test","llama3.2"])
            self.assertEqual(lan_ops.read_pool(path)[0]["models"],
                             ["glm-test","llama3.2"])
            out=io.StringIO()
            with contextlib.redirect_stdout(out):
                lan_ops.configure_provider(path,"list")
            self.assertIn("glm-test",out.getvalue())
            for invalid in ([],["a","a"],["invalid\nmodel"],
                            ["x"]*33,[42]):
                with self.subTest(invalid=invalid),self.assertRaises(ValueError):
                    lan_ops.configure_provider(path,"add",
                                               "http://192.168.1.62:11434/v1",
                                               models=invalid)
            self.assertEqual(len(lan_ops.read_pool(path)),1)
            with self.assertRaises(ValueError):
                lan_ops.configure_provider(path,"remove",url,models=["glm-test"])

    def test_rejects_symlinked_or_readable_environment(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            original=new_config(root)
            if os.name != "nt":
                original.chmod(0o644)
                with self.assertRaises(ValueError):
                    lan_ops.configure_provider(original,"add",
                                               "http://colibri/v1")
            if hasattr(os, "symlink"):
                another=root/"target"
                another.write_text("safe")
                original.unlink()
                try:
                    original.symlink_to(another)
                except OSError:
                    return
                with self.assertRaises(ValueError):
                    lan_ops.configure_provider(original,"add","http://colibri/v1")
                self.assertEqual(another.read_text(),"safe")

    def test_backup_invokes_age_with_secrets_only_in_encrypted_archive(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            new_config(root)
            (root/"lan-clients.txt").write_text("pc: secret")
            seen=[]
            def fake_compose(_cfg,*params):
                return ["docker","compose",*params]
            def fake_invoke(cmd,**kwargs):
                if cmd[2]=="cp":
                    destination=Path(cmd[-1])
                    destination.write_text("snapshot private bytes")
                return subprocess.CompletedProcess(cmd,0,"","")
            def fake_age(cmd,**kwargs):
                if cmd[0]=="whoami":
                    return subprocess.CompletedProcess(cmd,0,
                        '"user","S-1-5-21-111-222-333-1001"\n',"")
                if cmd[0]=="icacls":
                    return subprocess.CompletedProcess(cmd,0,"","")
                self.assertEqual(cmd[0],"age")
                with tarfile.open(cmd[-1],"r:gz") as archive:
                    seen.extend(archive.getnames())
                    self.assertIn(b"admin-secret",archive.extractfile(".env.lan").read())
                Path(cmd[cmd.index("-o")+1]).write_bytes(b"age-encrypted-fixture")
                return subprocess.CompletedProcess(cmd,0,"","")
            with mock.patch.object(lan_ops.shutil,"which",return_value="/usr/bin/age"),mock.patch.object(
                    lan_ops.subprocess,"run",side_effect=fake_age),contextlib.redirect_stdout(io.StringIO()):
                saved=lan_ops.encrypted_backup(root,{},fake_compose,fake_invoke,
                    "age1"+"x"*58,root/"backups")
            self.assertTrue(saved.exists())
            self.assertEqual(saved.read_bytes(),b"age-encrypted-fixture")
            self.assertIn("runtime/clients.json",seen)
            self.assertIn("caddy/root.key",seen)
            self.assertNotIn("snapshot.tar.gz",[p.name for p in (root/"backups").iterdir()])
            if os.name != "nt":
                self.assertEqual(saved.stat().st_mode & 0o777,0o600)

    def test_backup_refuses_absent_age_and_invalid_recipient(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);new_config(root)
            with self.assertRaises(ValueError):
                lan_ops.encrypted_backup(root,{},lambda *_:[],lambda *_:None,
                                         "bad-recipient",root/"backups")
            with mock.patch.object(lan_ops.shutil,"which",return_value=None):
                with self.assertRaises(ValueError):
                    lan_ops.encrypted_backup(root,{},lambda *_:[],lambda *_:None,
                                             "age1"+"x"*58,root/"backups")


if __name__=="__main__":
    unittest.main()
