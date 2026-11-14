#!/usr/bin/env python3
"""Pure unit tests: real-provider probe URL and input policy (no network)."""
import unittest
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
from unittest import mock

from real_provider_probe import validate_upstream_url, qualify, write_report

class RealProviderProbeConfiguration(unittest.TestCase):
    def test_loopback_http_and_remote_https(self):
        self.assertEqual(validate_upstream_url('http://127.0.0.1:8000/v1'),
                         'http://127.0.0.1:8000/v1')
        self.assertEqual(validate_upstream_url('http://[::1]:8000/v1'),
                         'http://[::1]:8000/v1')
        self.assertEqual(validate_upstream_url('https://models.example.com/v1'),
                         'https://models.example.com/v1')

    def test_reject_remote_plaintext_and_credentials(self):
        invalid=[
            '', 'http://models.example.com/v1',
            'http://127.0.0.1.evil.example/v1',
            'https://user:password@models.example.com/v1',
            'https://models.example.com/v1?token=secret',
            'https://models.example.com/v1#fragment',
            'https://models.example.com/v1/',
            'file:///tmp/model',
            'http://[::1]:abc/v1',
            'http://[::1/v1',
            ' http://127.0.0.1:8000/v1',
            'http://127.0.0.1:0/v1',
        ]
        for value in invalid:
            with self.subTest(value=value),self.assertRaises(ValueError):
                validate_upstream_url(value)

    def test_metadata_report_redacts_model_and_secrets(self):
        secret_model="private-company-model"
        result=[{"protocol":"chat/completions",
                 "text_and_tool_replay":"passed","stream":"passed"}]
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"qualification.json"
            with mock.patch.dict(os.environ,{"GITHUB_SHA":"a"*40}):
                write_report(str(path),secret_model,"chat",True,True,result,True)
            report=json.loads(path.read_text())
            self.assertEqual(report["model_id_sha256"],
                hashlib.sha256(secret_model.encode()).hexdigest())
            self.assertEqual(report["gateway_commit"],"a"*40)
            self.assertTrue(report["qualified"])
            self.assertEqual(report["results"],result)
            self.assertNotIn(secret_model,path.read_text())
            self.assertNotIn("YAG_REAL_UPSTREAM_URL",path.read_text())
            self.assertNotIn("YAG_REAL_UPSTREAM_KEY",path.read_text())
            if os.name != "nt":
                self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o600)
            # The writer refuses to follow a symlink to an unrelated file.
            if hasattr(os,"O_NOFOLLOW"):
                target=Path(directory)/"target.txt"
                target.write_text("unchanged")
                link=Path(directory)/"link.json"
                link.symlink_to(target)
                with self.assertRaises(OSError):
                    write_report(str(link),secret_model,"chat",False,False,[],False)
                self.assertEqual(target.read_text(),"unchanged")

    def test_invalid_model_or_binary_rejected_without_network(self):
        with self.assertRaises(ValueError):
            qualify('/nonexistent/yag','http://127.0.0.1:8000/v1','', '')
        with self.assertRaises(ValueError):
            qualify('/nonexistent/yag','http://127.0.0.1:8000/v1','model name','')
        with self.assertRaises(ValueError):
            qualify('/nonexistent/yag','http://127.0.0.1:8000/v1','valid-model','')

if __name__=='__main__':
    unittest.main()
