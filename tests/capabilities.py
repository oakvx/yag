#!/usr/bin/env python3
"""Operator-declared capabilities can reject impossible requests, not infer model ability."""
import json
import os
import socket
import subprocess
import sys
import threading
import time
import unittest

from integration import Backend, KEY, UPKEY, MockServer, request

class DeclaredCapabilities(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend=MockServer(('127.0.0.1',0),Backend)
        threading.Thread(target=cls.backend.serve_forever,daemon=True).start()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0))
            cls.port=sock.getsockname()[1]
        env=dict(os.environ,YAG_BIND='127.0.0.1',YAG_PORT=str(cls.port),
            YAG_API_KEY=KEY,YAG_UPSTREAM_KEY=UPKEY,
            YAG_UPSTREAM_URL=f'http://127.0.0.1:{cls.backend.server_port}/v1',
            YAG_MODEL_ROUTES=json.dumps([{'model':'response-echo',
                'url':f'http://127.0.0.1:{cls.backend.server_port}/v1',
                'capabilities':{'tools':False,'streaming':False,
                    'reasoning':False,'vision':False,'max_context_tokens':4096}}]),
            YAG_ENFORCE_MODEL_CAPABILITIES='1',
            YAG_TIMEOUT='3',NO_PROXY='127.0.0.1,localhost')
        cls.proc=subprocess.Popen([sys.argv[1]],env=env,
                                  stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        for _ in range(100):
            if cls.proc.poll() is not None:
                raise RuntimeError(cls.proc.stderr.read().decode())
            try:
                if request(cls.port,'GET','/health',key=None)[0]==200:break
            except OSError:time.sleep(.03)
        else:raise RuntimeError('Gateway startup failed')
    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=5)
        cls.proc.stderr.close()
        cls.backend.shutdown()
        cls.backend.server_close()

    def test_declared_capabilities_visible_and_correct(self):
        s,_,b=request(self.port,'GET','/api/model-capabilities')
        self.assertEqual(s,200,b)
        item=json.loads(b)['data'][0]
        self.assertTrue(item['declared'])
        self.assertFalse(item['capabilities']['tools'])
        self.assertFalse(item['capabilities']['streaming'])
        self.assertEqual(item['capabilities']['max_context_tokens'],4096)

    def test_forbidden_chat_features_return_422(self):
        msg={'model':'response-echo','messages':[{'role':'user','content':'hello'}]}
        self.assertEqual(request(self.port,'POST','/v1/chat/completions',msg)[0],200)
        self.assertEqual(request(self.port,'POST','/v1/chat/completions',
            dict(msg,stream=True))[0],422)
        self.assertEqual(request(self.port,'POST','/v1/chat/completions',
            dict(msg,tools=[{'type':'function'}]))[0],422)
        self.assertEqual(request(self.port,'POST','/v1/chat/completions',
            dict(msg,reasoning_effort='high'))[0],422)

    def test_forbidden_translated_protocol_features(self):
        self.assertEqual(request(self.port,'POST','/v1/responses',
            {'model':'response-echo','input':'hello','stream':True})[0],422)
        self.assertEqual(request(self.port,'POST','/v1/messages',
            {'model':'response-echo','max_tokens':128,'stream':True,
             'messages':[{'role':'user','content':'hello'}]})[0],422)
        self.assertEqual(request(self.port,'POST','/v1/messages',
            {'model':'response-echo','max_tokens':128,
             'thinking':{'type':'enabled','budget_tokens':100},
             'messages':[{'role':'user','content':'hello'}]})[0],422)

if __name__=='__main__':
    unittest.main(argv=[sys.argv[0]])
