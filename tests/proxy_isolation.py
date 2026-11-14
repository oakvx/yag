#!/usr/bin/env python3
"""Ensure ambient proxies cannot capture a Host upstream bearer credential."""
import http.client
import json
import os
import socket
import subprocess
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ADMIN_KEY = 'gateway-test-key-1234567890'
UPSTREAM_KEY = 'private-upstream-secret-must-not-leak'


class Backend(BaseHTTPRequestHandler):
    seen = []
    def log_message(self, *_args): pass
    def do_GET(self):
        self.__class__.seen.append(self.headers.get('Authorization'))
        response = b'{"object":"list","data":[{"id":"fixture-model","owned_by":"local"}]}'
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(response)))
        self.end_headers()
        self.wfile.write(response)


class MaliciousProxy(BaseHTTPRequestHandler):
    captured = []
    def log_message(self, *_args): pass
    def do_GET(self):
        self.__class__.captured.append(self.headers.get('Authorization'))
        payload = b'proxy intercept blocked'
        self.send_response(502)
        self.send_header('Content-Length',str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class ProxyIsolationTests(unittest.TestCase):
    def test_no_ambient_http_or_all_proxy_exfiltration(self):
        Backend.seen=[]
        MaliciousProxy.captured=[]
        backend=ThreadingHTTPServer(('127.0.0.1',0),Backend)
        proxy=ThreadingHTTPServer(('127.0.0.1',0),MaliciousProxy)
        for server in (backend,proxy):
            threading.Thread(target=server.serve_forever,daemon=True).start()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0))
            port=sock.getsockname()[1]
        proxy_url=f'http://127.0.0.1:{proxy.server_port}'
        env=os.environ.copy()
        env.update({
            'YAG_BIND':'127.0.0.1',
            'YAG_PORT':str(port),
            'YAG_API_KEY':ADMIN_KEY,
            'YAG_UPSTREAM_URL':f'http://127.0.0.1:{backend.server_port}/v1',
            'YAG_UPSTREAM_KEY':UPSTREAM_KEY,
            'http_proxy':proxy_url,
            'HTTP_PROXY':proxy_url,
            'https_proxy':proxy_url,
            'HTTPS_PROXY':proxy_url,
            'all_proxy':proxy_url,
            'ALL_PROXY':proxy_url,
            'no_proxy':'',
            'NO_PROXY':'',
            'YAG_EXTRA_API_KEYS':'',
            'YAG_UPSTREAM_POOL':'',
            'YAG_MODEL_ROUTES':'',
        })
        host=sys.argv[1]
        process=subprocess.Popen([host],env=env,stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL)
        try:
            ready=False
            for _ in range(100):
                if process.poll() is not None:
                    self.fail('Host exited before proxy-isolation regression')
                try:
                    c=http.client.HTTPConnection('127.0.0.1',port,timeout=1)
                    c.request('GET','/health')
                    response=c.getresponse()
                    response.read()
                    c.close()
                    if response.status==200:
                        ready=True
                        break
                except OSError:time.sleep(.05)
            self.assertTrue(ready,'Host never became ready')
            c=http.client.HTTPConnection('127.0.0.1',port,timeout=5)
            c.request('GET','/v1/models',headers={'Authorization':'Bearer '+ADMIN_KEY})
            response=c.getresponse()
            data=response.read()
            c.close()
            self.assertEqual(response.status,200,data)
            self.assertIn('fixture-model',data.decode())
            self.assertEqual(Backend.seen,['Bearer '+UPSTREAM_KEY])
            self.assertEqual(MaliciousProxy.captured,[],
                             'Backend requests leaked into an environment proxy')
        finally:
            process.terminate()
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=3)
            backend.shutdown();proxy.shutdown()
            backend.server_close();proxy.server_close()


if __name__=='__main__':
    unittest.main(argv=[sys.argv[0]])
