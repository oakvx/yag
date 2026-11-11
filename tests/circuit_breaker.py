#!/usr/bin/env python3
"""Circuit breaker: no retry on 5xx; open admission falls back only if opted in."""
import json
import os
import socket
import subprocess
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler

from integration import Backend, KEY, UPKEY, MockServer, request

class BrokenBackend(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    calls=0
    def log_message(self,*_):pass
    def do_POST(self):
        self.rfile.read(int(self.headers['Content-Length']))
        BrokenBackend.calls+=1
        payload=b'{"error":{"message":"unhealthy route"}}'
        self.send_response(503)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

class CircuitBreaker(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.default=MockServer(('127.0.0.1',0),Backend)
        cls.broken=MockServer(('127.0.0.1',0),BrokenBackend)
        threading.Thread(target=cls.default.serve_forever,daemon=True).start()
        threading.Thread(target=cls.broken.serve_forever,daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.default.shutdown();cls.default.server_close()
        cls.broken.shutdown();cls.broken.server_close()

    def verify(self,fallback):
        BrokenBackend.calls=0
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0))
            port=sock.getsockname()[1]
        env=dict(os.environ,YAG_BIND='127.0.0.1',YAG_PORT=str(port),
                 YAG_API_KEY=KEY,YAG_UPSTREAM_KEY=UPKEY,
                 YAG_UPSTREAM_URL=f'http://127.0.0.1:{self.default.server_port}/v1',
                 YAG_MODEL_ROUTES=json.dumps([{'model':'response-echo',
                    'url':f'http://127.0.0.1:{self.broken.server_port}/v1'}]),
                 YAG_CIRCUIT_THRESHOLD='2',YAG_CIRCUIT_COOLDOWN_SECONDS='5',
                 YAG_FALLBACK_TO_DEFAULT='1' if fallback else '0',
                 YAG_TIMEOUT='3',NO_PROXY='127.0.0.1,localhost')
        proc=subprocess.Popen([sys.argv[1]],env=env,stdout=subprocess.DEVNULL,
                              stderr=subprocess.PIPE)
        try:
            for _ in range(100):
                if proc.poll() is not None:
                    raise RuntimeError(proc.stderr.read().decode())
                try:
                    if request(port,'GET','/health',key=None)[0]==200:break
                except OSError:time.sleep(.03)
            else:raise RuntimeError('Gateway did not start')
            payload={'model':'response-echo','messages':[{'role':'user','content':'hi'}]}
            for _ in range(2):
                status,_,body=request(port,'POST','/v1/chat/completions',payload)
                self.assertEqual(status,503,body)
                self.assertIn(b'unhealthy route',body)
            status,_,body=request(port,'POST','/v1/chat/completions',payload)
            self.assertEqual(status,200 if fallback else 502,body)
            self.assertEqual(BrokenBackend.calls,2,'Circuit failed to bypass broken route')
            data=json.loads(request(port,'GET','/api/providers/status')[2])
            self.assertEqual(data['object'],'gateway.providers')
            route=data['data'][1]
            self.assertEqual(route['model'],'response-echo')
            self.assertEqual(route['circuit'],'open')
            self.assertEqual(route['attempts'],2)
            self.assertEqual(route['failures'],2)
            self.assertEqual(route['bypassed'],1)
            self.assertEqual(route['fallbacks'],1 if fallback else 0)
            self.assertGreaterEqual(route['retry_after_seconds'],1)
            self.assertNotIn(b'http://',json.dumps(data).encode())
            self.assertEqual(request(port,'GET','/api/providers/status',key=None)[0],401)
            if fallback:
                self.assertEqual(data['data'][0]['successes'],1)
        finally:
            proc.terminate()
            proc.wait(timeout=6)
            proc.stderr.close()

    def test_open_route_rejects_without_retry(self):self.verify(False)
    def test_open_route_can_use_default_before_any_attempt(self):self.verify(True)

if __name__=='__main__':
    unittest.main(argv=[sys.argv[0]])
