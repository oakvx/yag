#!/usr/bin/env python3
"""Pure unit tests: real-provider probe URL and input policy (no network)."""
import unittest
import hashlib
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import stat
import tempfile
from unittest import mock

from real_provider_probe import validate_upstream_url, qualify, write_report, probe_ollama_manifest

class MockOllama(BaseHTTPRequestHandler):
    digest='f'*64
    def log_message(self,*_args): pass
    def do_GET(self):
        if self.path!='/api/tags':
            self.send_error(404)
            return
        payload=json.dumps({'models':[
            {'name':'qualified-model:latest','digest':'sha256:'+self.digest},
            {'name':'other-model','digest':'2'*64},
        ]}).encode()
        self.send_response(200)
        self.send_header('Content-Length',str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

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

    def test_only_exact_local_manifest_digest_is_accepted(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),MockOllama)
        thread=threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        try:
            address=f'http://127.0.0.1:{server.server_port}'
            with mock.patch.dict(os.environ,{'HTTP_PROXY':'http://127.0.0.1:1',
                                             'http_proxy':'http://127.0.0.1:1',
                                             'NO_PROXY':'','no_proxy':''}):
                self.assertEqual(probe_ollama_manifest('qualified-model:latest',address),
                                 'f'*64)
            self.assertIsNone(probe_ollama_manifest('qualified-model',address))
            self.assertIsNone(probe_ollama_manifest('missing',address))
            self.assertIsNone(probe_ollama_manifest('qualified-model:latest',
                                                   'http://public.example.com'))
            self.assertIsNone(probe_ollama_manifest('qualified-model:latest',
                                                   address+'/api/tags'))
            self.assertIsNone(probe_ollama_manifest('qualified-model:latest',
                                                   'http://user:pass@127.0.0.1:11434'))
            self.assertIsNone(probe_ollama_manifest('qualified-model:latest',
                                                   'http://127.0.0.1:0'))
            original=MockOllama.digest
            try:
                MockOllama.digest='not-a-sha'
                self.assertIsNone(probe_ollama_manifest('qualified-model:latest',address))
            finally:
                MockOllama.digest=original
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_report_includes_digest_only_when_locally_measured(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),MockOllama)
        thread=threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as folder:
                path=Path(folder)/'report.json'
                with mock.patch.dict(os.environ,{
                    'GITHUB_SHA':'a'*40,
                    'YAG_REAL_OLLAMA_NATIVE_URL':f'http://127.0.0.1:{server.server_port}',
                }):
                    write_report(str(path),'qualified-model:latest','all',True,True,[],True)
                report=json.loads(path.read_text())
                self.assertEqual(report['schema_version'],3)
                self.assertEqual(report['ollama_manifest_sha256'],'f'*64)
                self.assertEqual(report['ollama_manifest_source'],'ollama_api_tags')
                self.assertNotIn('qualified-model:latest',path.read_text())
                with mock.patch.dict(os.environ,{'YAG_REAL_OLLAMA_NATIVE_URL':''}):
                    write_report(str(path),'qualified-model:latest','all',True,True,[],True)
                self.assertIsNone(json.loads(path.read_text())['ollama_manifest_sha256'])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_invalid_model_or_binary_rejected_without_network(self):
        with self.assertRaises(ValueError):
            qualify('/nonexistent/yag','http://127.0.0.1:8000/v1','', '')
        with self.assertRaises(ValueError):
            qualify('/nonexistent/yag','http://127.0.0.1:8000/v1','model name','')
        with self.assertRaises(ValueError):
            qualify('/nonexistent/yag','http://127.0.0.1:8000/v1','valid-model','')

if __name__=='__main__':
    unittest.main()
