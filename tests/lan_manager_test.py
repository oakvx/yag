#!/usr/bin/env python3
"""Platform-independent LAN manager regression tests; Docker daemon not required."""
import contextlib
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import lan
import lan_bootstrap


def config(managed=False):
    return {
        "YAG_LAN_IP": "192.168.40.9",
        "YAG_API_KEY": "admin-secret",
        "YAG_EXTRA_API_KEYS": "client-a,client-b",
        "YAG_EXTRA_KEY_SCOPES": "inference+models,inference+models",
        "YAG_UPSTREAM_URL": lan.MANAGED_UPSTREAM if managed
        else "http://host.docker.internal:11434/v1",
    }


class LanManagerTest(unittest.TestCase):
    def test_init_is_offline_and_works_without_docker(self):
        with tempfile.TemporaryDirectory() as temp:
            with mock.patch.object(lan, "ROOT", Path(temp)), mock.patch.object(
                    lan, "ENV_PATH", Path(temp) / ".env.lan"), mock.patch.object(
                    lan.shutil, "which", return_value=None), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(lan.main(["init", "--lan-ip", "192.168.40.9",
                                           "--clients", "2", "--managed-ollama"]), 0)
                loaded = lan.read_config()
                self.assertTrue(lan.managed(loaded))
                self.assertEqual(len(loaded["YAG_EXTRA_API_KEYS"].split(",")), 2)
                self.assertNotEqual(loaded["YAG_API_KEY"],
                                    loaded["YAG_EXTRA_API_KEYS"].split(",")[0])
                # Initialization is deliberately non-destructive.
                with self.assertRaises(SystemExit):
                    lan.main(["init", "--lan-ip", "192.168.40.9"])

    def test_external_and_managed_compose_files(self):
        for mode in (False, True):
            with self.subTest(managed=mode):
                cmd = lan.compose_command(config(mode), "up", "--build", "-d")
                self.assertEqual(cmd[:2], ["docker", "compose"])
                self.assertIn("compose.yaml", " ".join(cmd))
                self.assertIn("compose.lan.yaml", " ".join(cmd))
                self.assertEqual("compose.lan.ollama.yaml" in " ".join(cmd), mode)
                self.assertNotIn("down", cmd)
        down = lan.compose_command(config(True), "down")
        self.assertNotIn("-v", down)
        self.assertNotIn("--volumes", down)

    def test_shell_cannot_shadow_generated_lan_secrets(self):
        with mock.patch.dict(os.environ, {
            "YAG_API_KEY": "leak-admin",
            "YAG_LAN_IP": "8.8.8.8",
            "COMPOSE_FILE": "attacker.yml",
            "COMPOSE_PROFILES": "evil",
            "SAFE_TEST": "present",
        }):
            result = lan.docker_environment()
            self.assertEqual(result["SAFE_TEST"], "present")
            for name in ("YAG_API_KEY", "YAG_LAN_IP", "COMPOSE_FILE",
                         "COMPOSE_PROFILES"):
                self.assertNotIn(name, result)

    def test_doctor_checks_daemon_and_quiet_compose_config(self):
        seen = []
        def fake_invoke(cmd, **kwargs):
            seen.append(cmd)
            return subprocess.CompletedProcess(cmd, 0, "", "")
        with mock.patch.object(lan.shutil, "which", return_value="docker"), mock.patch.object(
                lan, "invoke", side_effect=fake_invoke), contextlib.redirect_stdout(io.StringIO()):
            lan.doctor(config(True))
        self.assertEqual(len(seen), 3)
        self.assertEqual(seen[0][:3], ["docker", "compose", "version"])
        self.assertEqual(seen[1][:2], ["docker", "info"])
        self.assertEqual(seen[2][-2:], ["config", "--quiet"])

    def test_doctor_fails_without_docker(self):
        with mock.patch.object(lan.shutil, "which", return_value=None):
            with self.assertRaises(lan.SetupError):
                lan.require_docker(config())

    def test_check_verifies_tls_and_key_isolation(self):
        with mock.patch.object(lan, "https_status", side_effect=[200, 401, 403, 200]) as get:
            with contextlib.redirect_stdout(io.StringIO()):
                lan.verify(config())
        self.assertEqual(get.call_args_list, [
            mock.call(config(), "/health", None),
            mock.call(config(), "/v1/models", None),
            mock.call(config(), "/api/clients", "client-a"),
            mock.call(config(), "/api/clients", "admin-secret"),
        ])

    def test_check_fails_closed_on_wrong_status(self):
        with mock.patch.object(lan, "https_status", return_value=200):
            with self.assertRaises(lan.SetupError):
                lan.verify(config())

    def test_model_pull_is_managed_only_and_never_uses_shell(self):
        with mock.patch.object(lan, "read_config", return_value=config(True)), mock.patch.object(
                lan, "invoke", return_value=subprocess.CompletedProcess([], 0)) as run:
            self.assertEqual(lan.main(["model", "llama3.2:latest"]), 0)
            command = run.call_args.args[0]
            self.assertEqual(command[-5:], ["-T", "ollama", "ollama", "pull", "llama3.2:latest"])
            self.assertEqual(lan.main(["model", "x;rm -rf /"]), 1)
            self.assertEqual(run.call_count, 1)
        with mock.patch.object(lan, "read_config", return_value=config(False)):
            self.assertEqual(lan.main(["model", "llama3.2"]), 1)

    def test_refuses_invalid_or_public_ip_in_existing_config(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / ".env.lan"
            with mock.patch.object(lan, "ENV_PATH", path):
                for ip in ("8.8.8.8", "127.0.0.1", "not-an-ip"):
                    with self.subTest(ip=ip):
                        path.write_text("\n".join(k + "=" + v for k, v in
                            {**config(), "YAG_LAN_IP": ip}.items()))
                        with self.assertRaises(lan.SetupError):
                            lan.read_config()

    def test_ca_refuses_to_overwrite_existing_certificate(self):
        with tempfile.TemporaryDirectory() as temp:
            cert = Path(temp) / "lan-root-ca.crt"
            cert.write_text("existing trust anchor")
            with mock.patch.object(lan, "CA_PATH", cert), mock.patch.object(
                    lan, "invoke") as docker:
                with self.assertRaises(lan.SetupError):
                    lan.export_ca(config())
                docker.assert_not_called()
            self.assertEqual(cert.read_text(), "existing trust anchor")

    def test_ca_export_prints_fingerprint_not_credentials(self):
        with tempfile.TemporaryDirectory() as temp:
            cert = Path(temp) / "lan-root-ca.crt"
            def docker_cp(command, **kwargs):
                cert.write_text("-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----")
                return subprocess.CompletedProcess(command, 0, "", "")
            out = io.StringIO()
            with mock.patch.object(lan, "CA_PATH", cert), mock.patch.object(
                    lan, "invoke", side_effect=docker_cp), mock.patch.object(
                    lan.ssl, "PEM_cert_to_DER_cert", return_value=b"fake-cert"), contextlib.redirect_stdout(out):
                lan.export_ca(config())
            self.assertIn("SHA-256 fingerprint:", out.getvalue())
            self.assertNotIn("admin-secret", out.getvalue())

    def test_windows_acl_uses_sid_not_localized_account_name(self):
        calls = []
        def fake_run(command, **kwargs):
            calls.append(command)
            if command[0] == "whoami":
                return subprocess.CompletedProcess(command, 0,
                    '"user","S-1-5-21-111-222-333-1001"\n', "")
            return subprocess.CompletedProcess(command, 0, "", "")
        with mock.patch.object(lan_bootstrap.subprocess, "run", side_effect=fake_run):
            lan_bootstrap.secure_windows_acl(Path("credentials.txt"))
        self.assertEqual(calls[0][:2], ["whoami", "/user"])
        self.assertIn("*S-1-5-21-111-222-333-1001:(F)", calls[1])

    def test_windows_acl_rejects_invalid_sid(self):
        with mock.patch.object(lan_bootstrap.subprocess, "run",
                               return_value=subprocess.CompletedProcess([], 0, '"user","BAD"\n', "")):
            with self.assertRaises(OSError):
                lan_bootstrap.secure_windows_acl(Path("credentials.txt"))


if __name__ == "__main__":
    unittest.main()
