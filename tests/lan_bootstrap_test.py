#!/usr/bin/env python3
"""Private LAN bootstrap regression tests; no Docker or Ollama required."""
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "lan_bootstrap.py"


def invoke(directory, *arguments):
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--output-dir", str(directory), *arguments],
        capture_output=True, text=True, check=False, timeout=10)


def env_values(path):
    return dict(line.split("=", 1) for line in path.read_text().splitlines()
                if line and not line.startswith("#"))


class LanBootstrapTest(unittest.TestCase):
    def test_managed_mode_generates_isolated_client_credentials(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            result = invoke(folder, "--lan-ip", "192.168.50.20",
                            "--clients", "4", "--managed-ollama")
            self.assertEqual(result.returncode, 0, result.stderr)
            env = env_values(folder / ".env.lan")
            self.assertEqual(env["YAG_LAN_IP"], "192.168.50.20")
            self.assertEqual(env["YAG_UPSTREAM_URL"], "http://ollama:11434/v1")
            self.assertEqual(env["YAG_RATE_LIMIT_PER_MINUTE"], "120")
            self.assertGreaterEqual(len(env["YAG_API_KEY"]), 48)
            keys = env["YAG_EXTRA_API_KEYS"].split(",")
            self.assertEqual(len(keys), 4)
            self.assertEqual(len(set(keys)), 4)
            self.assertNotIn(env["YAG_API_KEY"], keys)
            self.assertTrue(all(len(key) >= 32 for key in keys))
            self.assertEqual(env["YAG_EXTRA_KEY_SCOPES"],
                             ",".join(["inference+models"] * 4))
            client_file = (folder / "lan-clients.txt").read_text()
            self.assertIn("https://192.168.50.20/v1", client_file)
            self.assertNotIn(env["YAG_API_KEY"], client_file)
            for key in keys:
                self.assertIn(key, client_file)
                self.assertNotIn(key, result.stdout)
                self.assertNotIn(key, result.stderr)
            self.assertNotIn(env["YAG_API_KEY"], result.stdout)
            if os.name == "posix":
                for filename in (".env.lan", "lan-clients.txt"):
                    self.assertEqual(stat.S_IMODE((folder / filename).stat().st_mode),
                                     0o600)

    def test_external_mode_uses_existing_host_ollama(self):
        with tempfile.TemporaryDirectory() as temp:
            result = invoke(temp, "--lan-ip", "10.10.2.5")
            self.assertEqual(result.returncode, 0, result.stderr)
            env = env_values(Path(temp) / ".env.lan")
            self.assertEqual(env["YAG_UPSTREAM_URL"],
                             "http://host.docker.internal:11434/v1")
            self.assertEqual(len(env["YAG_EXTRA_API_KEYS"].split(",")), 3)

    def test_invalid_addresses_and_client_counts_do_not_write_files(self):
        for invalid in ("127.0.0.1", "8.8.8.8", "169.254.1.1",
                        "::1", "0.0.0.0", "not-an-ip", "172.32.1.5"):
            with self.subTest(address=invalid), tempfile.TemporaryDirectory() as temp:
                result = invoke(temp, "--lan-ip", invalid)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((Path(temp) / ".env.lan").exists())
        for invalid in ("0", "17", "-1", "abc"):
            with self.subTest(clients=invalid), tempfile.TemporaryDirectory() as temp:
                result = invoke(temp, "--lan-ip", "192.168.1.5",
                                "--clients", invalid)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((Path(temp) / ".env.lan").exists())

    def test_never_overwrites_existing_secrets(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            first = invoke(folder, "--lan-ip", "172.16.10.9")
            self.assertEqual(first.returncode, 0, first.stderr)
            original_env = (folder / ".env.lan").read_bytes()
            original_keys = (folder / "lan-clients.txt").read_bytes()
            second = invoke(folder, "--lan-ip", "172.16.10.9")
            self.assertNotEqual(second.returncode, 0)
            self.assertEqual((folder / ".env.lan").read_bytes(), original_env)
            self.assertEqual((folder / "lan-clients.txt").read_bytes(),
                             original_keys)

    @unittest.skipUnless(hasattr(os, "symlink"), "Symlinks not supported")
    def test_refuses_symlink_targets(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            victim = folder / "victim"
            victim.write_text("must not be overwritten")
            (folder / ".env.lan").symlink_to(victim)
            result = invoke(folder, "--lan-ip", "192.168.1.2")
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(victim.read_text(), "must not be overwritten")
            self.assertFalse((folder / "lan-clients.txt").exists())


if __name__ == "__main__":
    unittest.main()
