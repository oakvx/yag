#!/usr/bin/env python3
"""Operator-declared capabilities can reject known unsupported features."""
import json
import os
import socket
import subprocess
import sys
import threading
import time
import unittest
from integration import Backend, KEY, UPKEY, MockServer, request

class CapabilityPolicy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend=MockServer(('127.0.0.1',0),Backend)
        threading.Thread(target=cls.backend.serve_forever,daemon=True).start()
        with socket.socket() as s:
            s.bind(('127.0.0.1',0))
            cls.port=s.getsockname()[1]
        env=dict(os.environ,YAG_BIND='127.0.0.1',YAG_PORT=str(cls.port),
            YAG_API_KEY=KEY,YAG_UPSTREAM_KEY=UPKEY,YAG_TIMEOUT='3',
            YAG_UPSTREAM_URL=f'http://127.0.0.1:{cls.backend.server_port}/v1',
            YAG_MODEL_CAPABILITIES=json.dumps([
                {'model':'response-echo','features':[]},
                {'model':'response-tools','features':['function_tools']},
                {'model':'response-stream','features':['streaming']}]),
            YAG_ENFORCE_MODEL_CAPABILITIES='1',
            NO_PROXY='127.0.0.1,localhost')
        cls.proc=subprocess.Popen([sys.argv[1]],env=env,
            stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        for _ in range(100):
            if cls.proc.poll() is not None:
                raise RuntimeError(cls.proc.stderr.read().decode())
            try:
                if request(cls.port,'GET','/health',key=None)[0]==200:break
            except OSError:time.sleep(.03)
        else:raise RuntimeError('Gateway not ready')

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate();cls.proc.wait(timeout=6);cls.proc.stderr.close()
        cls.backend.shutdown();cls.backend.server_close()

    def test_registry_is_not_model_verification(self):
        status,_,body=request(self.port,'GET','/api/models/capabilities')
        self.assertEqual(status,200,body)
        self.assertFalse(json.loads(body)['verified'])

    def test_denied_chat_features(self):
        p={'model':'response-echo','messages':[{'role':'user','content':'Hello'}]}
        self.assertEqual(request(self.port,'POST','/v1/chat/completions',p)[0],200)
        self.assertEqual(request(self.port,'POST','/v1/chat/completions',
            dict(p,stream=True))[0],422)
        self.assertEqual(request(self.port,'POST','/v1/chat/completions',
            dict(p,tools=[{'type':'function','function':{
                'name':'read','parameters':{'type':'object'}}}]))[0],422)
        self.assertEqual(request(self.port,'POST','/v1/chat/completions',
            dict(p,reasoning_effort='high'))[0],422)

    def test_denied_responses_and_anthropic(self):
        self.assertEqual(request(self.port,'POST','/v1/responses',{
            'model':'response-echo','input':'Hello',
            'stream':True})[0],422)
        self.assertEqual(request(self.port,'POST','/v1/responses',{
            'model':'response-echo','input':'Hello',
            'tools':[{'type':'function','name':'read',
                      'parameters':{'type':'object'}}]})[0],422)
        self.assertEqual(request(self.port,'POST','/v1/messages',{
            'model':'response-echo','max_tokens':32,
            'messages':[{'role':'user','content':'Hello'}],
            'thinking':{'type':'enabled','budget_tokens':16}})[0],422)
        self.assertEqual(request(self.port,'POST','/v1/messages',{
            'model':'response-echo','max_tokens':32,
            'messages':[{'role':'user','content':'Hello'}],
            'stream':True})[0],422)

    def test_known_supported_and_undeclared_are_forwarded(self):
        status,_,body=request(self.port,'POST','/v1/chat/completions',{
            'model':'response-tools','messages':[{'role':'user','content':'Hello'}],
            'tools':[{'type':'function','function':{
                'name':'read','parameters':{'type':'object'}}}]})
        self.assertEqual(status,200,body)
        self.assertEqual(request(self.port,'POST','/v1/chat/completions',{
            'model':'unlisted-model','messages':[{'role':'user','content':'Hello'}]})[0],200)

    def test_invalid_policy_setting_fails_before_listening(self):
        for value in ('true','yes','2'):
            env=dict(os.environ,YAG_API_KEY=KEY,YAG_ENFORCE_MODEL_CAPABILITIES=value)
            finished=subprocess.run([sys.argv[1]],env=env,timeout=2,capture_output=True)
            self.assertNotEqual(finished.returncode,0,value)
            self.assertIn(b'YAG_ENFORCE_MODEL_CAPABILITIES',finished.stderr)

if __name__=='__main__':
    unittest.main(argv=[sys.argv[0]])
