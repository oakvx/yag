#!/usr/bin/env python3
"""Docker Compose topology assertions for both LAN deployment modes."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BOOTSTRAP = ROOT / "scripts" / "lan_bootstrap.py"


@unittest.skipUnless(shutil.which("docker"), "Docker CLI required")
class LanComposeTest(unittest.TestCase):
    def check_topology(self, managed):
        with tempfile.TemporaryDirectory() as temp:
            args = [sys.executable, str(BOOTSTRAP), "--output-dir", temp,
                    "--lan-ip", "192.168.50.20", "--clients", "3"]
            if managed:
                args.append("--managed-ollama")
            subprocess.run(args, check=True, capture_output=True, text=True)
            files = ["compose.yaml", "compose.lan.yaml"]
            if managed:
                files.append("compose.lan.ollama.yaml")
            cmd = ["docker", "compose", "--env-file", str(Path(temp) / ".env.lan")]
            for filename in files:
                cmd.extend(["-f", filename])
            cmd.extend(["config", "--format", "json"])
            env = {k: v for k, v in os.environ.items()
                   if not k.startswith("YAG_")}
            result = subprocess.run(cmd, cwd=ROOT, env=env, check=False,
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            config = json.loads(result.stdout)
            services = config["services"]
            yag = services["yag"]
            caddy = services["caddy"]
            self.assertEqual(yag["environment"]["YAG_EXTRA_KEY_SCOPES"],
                             "inference+models,inference+models,inference+models")
            self.assertEqual(yag["environment"]["YAG_RATE_LIMIT_PER_MINUTE"], "120")
            self.assertEqual(len(yag["ports"]), 1)
            self.assertEqual(yag["ports"][0]["host_ip"], "127.0.0.1")
            self.assertEqual(str(yag["ports"][0]["published"]), "8080")
            self.assertEqual(len(caddy["ports"]), 1)
            self.assertEqual(caddy["ports"][0]["host_ip"], "192.168.50.20")
            self.assertEqual(str(caddy["ports"][0]["published"]), "443")
            self.assertEqual(caddy["environment"]["YAG_LAN_IP"],
                             "192.168.50.20")
            self.assertTrue(caddy["read_only"])
            if managed:
                self.assertIn("ollama", services)
                self.assertFalse(services["ollama"].get("ports"))
                self.assertEqual(yag["environment"]["YAG_UPSTREAM_URL"],
                                 "http://ollama:11434/v1")
            else:
                self.assertNotIn("ollama", services)
                self.assertEqual(yag["environment"]["YAG_UPSTREAM_URL"],
                                 "http://host.docker.internal:11434/v1")

    def test_existing_host_ollama(self):
        self.check_topology(False)

    def test_managed_private_ollama(self):
        self.check_topology(True)


if __name__ == "__main__":
    unittest.main()
