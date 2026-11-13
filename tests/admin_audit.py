#!/usr/bin/env python3
"""Administrative audit events never log secrets, prompts or request bodies."""
import concurrent.futures
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest

from integration import Backend, KEY, MockServer, UPKEY, request


class AdminAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.binary=sys.argv[1]
        cls.tmp=tempfile.TemporaryDirectory()
        cls.backend=MockServer(("127.0.0.1",0),Backend)
        threading.Thread(target=cls.backend.serve_forever,daemon=True).start()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1",0))
            cls.port=sock.getsockname()[1]
        cls.audit=Path(cls.tmp.name)/"events.jsonl"
        cls.store=Path(cls.tmp.name)/"clients.json"
        cls.env=dict(os.environ,YAG_BIND="127.0.0.1",YAG_PORT=str(cls.port),
                     YAG_API_KEY=KEY,YAG_UPSTREAM_KEY=UPKEY,
                     YAG_UPSTREAM_URL="http://127.0.0.1:"+str(cls.backend.server_port)+"/v1",
                     YAG_CLIENT_STORE=str(cls.store),
                     YAG_ADMIN_AUDIT_FILE=str(cls.audit),
                     YAG_EXTRA_API_KEYS="test-client-credential-123456",
                     YAG_EXTRA_KEY_SCOPES="inference")
        cls.proc=subprocess.Popen([cls.binary],env=cls.env,
                                  stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        for _ in range(100):
            if cls.proc.poll() is not None:
                raise RuntimeError(cls.proc.stderr.read().decode())
            try:
                if request(cls.port,"GET","/health",key=None)[0]==200:
                    break
            except OSError:
                time.sleep(.03)
        else:
            raise RuntimeError("YAG failed to start")

    @classmethod
    def tearDownClass(cls):
        if cls.proc.poll() is None:
            cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.proc.stderr.close()
        cls.backend.shutdown()
        cls.backend.server_close()
        cls.tmp.cleanup()

    def test_admin_statuses_are_redacted_and_lines_are_valid_json(self):
        self.assertEqual(request(self.port,"GET","/api/admin/clients")[0],200)
        self.assertEqual(request(self.port,"POST","/api/admin/clients",
            {"name":"Studio PC","scope":"inference"})[0],201)
        self.assertEqual(request(self.port,"GET","/api/admin/clients",
            key="test-client-credential-123456")[0],403)
        self.assertEqual(request(self.port,"GET","/api/admin/clients",
            key="wrong-key")[0],401)
        self.assertEqual(request(self.port,"GET","/health",key=None)[0],200)
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            results=list(pool.map(lambda _:request(self.port,"GET",
                          "/api/admin/clients")[0],range(10)))
            self.assertEqual(results,[200]*10)
        lines=self.audit.read_text().splitlines()
        self.assertEqual(len(lines),14)
        entries=[json.loads(line) for line in lines]
        self.assertEqual([item["status"] for item in entries[:4]],
                         [200,201,403,401])
        self.assertTrue(all(item["event"]=="admin_http_response" for item in entries))
        self.assertTrue(all(item["resource"]=="clients" for item in entries))
        self.assertTrue(all(item["method"] in ("GET","POST") for item in entries))
        content=self.audit.read_text()
        for secret in (KEY,UPKEY,"test-client-credential","wrong-key","Studio PC"):
            self.assertNotIn(secret,content)
        self.assertTrue(all(set(item)=={"ts_unix","event","resource","method","status"}
                            for item in entries))
        if os.name!="nt":
            self.assertEqual(stat.S_IMODE(self.audit.stat().st_mode),0o600)

    def test_rejects_insecure_audit_paths_at_startup(self):
        path=Path(self.tmp.name)/"insecure.jsonl"
        path.write_text("preexisting insecure file")
        path.chmod(0o644)
        if os.name!="nt":
            env=dict(self.env,YAG_ADMIN_AUDIT_FILE=str(path),YAG_PORT="0")
            proc=subprocess.run([self.binary],env=env,stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE,timeout=5)
            self.assertNotEqual(proc.returncode,0)
            self.assertIn(b"YAG_ADMIN_AUDIT_FILE",proc.stderr)
        link=Path(self.tmp.name)/"audit-link"
        try:
            link.symlink_to(path)
        except (OSError, NotImplementedError):
            return
        env=dict(self.env,YAG_ADMIN_AUDIT_FILE=str(link),YAG_PORT="0")
        proc=subprocess.run([self.binary],env=env,stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,timeout=5)
        self.assertNotEqual(proc.returncode,0)
        self.assertIn(b"YAG_ADMIN_AUDIT_FILE",proc.stderr)


if __name__=="__main__":
    unittest.main(argv=[sys.argv[0]])
