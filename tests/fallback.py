#!/usr/bin/env python3
"""Verify that opt-in fallback only retries pre-response connection failures."""
import json
import http.client
import os
import socket
import subprocess
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler

from integration import Backend, KEY, UPKEY, MockServer, request

class RejectingBackend(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*_): pass
    def do_POST(self):
        data=b'{"error":{"message":"route denied"}}'
        self.send_response(401)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        self.wfile.write(data)

class Fallback(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.default=MockServer(('127.0.0.1',0),Backend)
        cls.rejecting=MockServer(('127.0.0.1',0),RejectingBackend)
        threading.Thread(target=cls.default.serve_forever,daemon=True).start()
        threading.Thread(target=cls.rejecting.serve_forever,daemon=True).start()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0))
            unreachable=sock.getsockname()[1]
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0))
            cls.port=sock.getsockname()[1]
        routes=[
            {'model':'response-echo','url':f'http://127.0.0.1:{unreachable}/v1'},
            {'model':'response-stream','url':f'http://127.0.0.1:{unreachable}/v1'},
            {'model':'deny-fallback','url':f'http://127.0.0.1:{cls.rejecting.server_port}/v1'}
        ]
        env=dict(os.environ,YAG_BIND='127.0.0.1',YAG_PORT=str(cls.port),
                 YAG_API_KEY=KEY,YAG_UPSTREAM_KEY=UPKEY,
                 YAG_UPSTREAM_URL=f'http://127.0.0.1:{cls.default.server_port}/v1',
                 YAG_MODEL_ROUTES=json.dumps(routes),
                 YAG_FALLBACK_TO_DEFAULT='1',YAG_TIMEOUT='2',
                 NO_PROXY='127.0.0.1,localhost')
        cls.proc=subprocess.Popen([sys.argv[1]],env=env,stderr=subprocess.PIPE,
                                  stdout=subprocess.DEVNULL)
        for _ in range(100):
            if cls.proc.poll() is not None:
                raise RuntimeError(cls.proc.stderr.read().decode())
            try:
                if request(cls.port,'GET','/health',key=None)[0]==200:break
            except OSError:time.sleep(.03)
        else:raise RuntimeError('Fallback Host did not start')

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=5)
        cls.proc.stderr.close()
        cls.default.shutdown()
        cls.default.server_close()
        cls.rejecting.shutdown()
        cls.rejecting.server_close()

    def test_chat_fallback_after_connect_refused(self):
        payload={'model':'response-echo','messages':[{'role':'user','content':'hello'}]}
        status,_,body=request(self.port,'POST','/v1/chat/completions',payload)
        self.assertEqual(status,200,body)
        self.assertEqual(json.loads(body)['request'],payload)

    def test_responses_fallback_after_connect_refused(self):
        status,_,body=request(self.port,'POST','/v1/responses',
                              {'model':'response-echo','input':'hello'})
        self.assertEqual(status,200,body)
        self.assertEqual(json.loads(body)['object'],'response')

    def test_anthropic_fallback_after_connect_refused(self):
        status,_,body=request(self.port,'POST','/v1/messages',
                              {'model':'response-echo','max_tokens':20,
                               'messages':[{'role':'user','content':'hello'}]})
        self.assertEqual(status,200,body)
        self.assertEqual(json.loads(body)['type'],'message')

    def test_streaming_protocols_fallback(self):
        status,_,body=request(self.port,'POST','/v1/responses',
                              {'model':'response-stream','input':'hello','stream':True})
        self.assertEqual(status,200,body)
        self.assertIn(b'response.completed',body)
        status,_,body=request(self.port,'POST','/v1/messages',
                              {'model':'response-stream','max_tokens':20,
                               'messages':[{'role':'user','content':'hello'}],
                               'stream':True})
        self.assertEqual(status,200,body)
        self.assertIn(b'event: message_stop',body)

    def test_no_fallback_after_authentication_failure(self):
        payload={'model':'deny-fallback','messages':[{'role':'user','content':'hello'}]}
        status,_,body=request(self.port,'POST','/v1/chat/completions',payload)
        self.assertEqual(status,401,body)
        self.assertIn(b'route denied',body)

if __name__=='__main__':
    unittest.main(argv=[sys.argv[0]])
