#!/usr/bin/env python3
"""End-to-end HTTP tests against an in-process mock OpenAI-compatible runtime."""
import concurrent.futures
import http.client
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KEY = 'integration-test-key-12345'
UPKEY = 'upstream-secret'
class MockServer(ThreadingHTTPServer):
    request_queue_size = 64

class Backend(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *_): pass
    def send(self, status, data, typ='application/json'):
        data = data if isinstance(data, bytes) else json.dumps(data).encode()
        self.send_response(status); self.send_header('Content-Type',typ); self.send_header('Content-Length',str(len(data))); self.end_headers()
        try: self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError): pass
    def do_GET(self):
        if self.headers.get('Authorization') != 'Bearer '+UPKEY: return self.send(401, {'error': {'message':'bad upstream key'}})
        self.send(200, {'object':'list','data':[{'id':'glm-test','owned_by':'local'}]})
    def do_POST(self):
        if self.headers.get('Authorization') != 'Bearer '+UPKEY: return self.send(401, {'error': {'message':'bad upstream key'}})
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if data['model']=='slow': time.sleep(2); return self.send(200, {})
        if data['model']=='bad': return self.send(429, {'error':{'message':'backend limit'}})
        if data['model']=='anthropic-tools':
            return self.send(200, {'object':'chat.completion','choices':[{'message':{
                'role':'assistant','content':'I need the file',
                'tool_calls':[{'id':'call_read','type':'function',
                    'function':{'name':'read_file','arguments':'{"path":"src/main.c"}'}}]
                },'finish_reason':'tool_calls'}],
                'usage':{'prompt_tokens':15,'completion_tokens':7,'total_tokens':22}})
        if data['model']=='response-echo':
            return self.send(200, {'object':'chat.completion','choices':[{'message':{'role':'assistant','content':json.dumps(data)},'finish_reason':'stop'}], 'usage': {'prompt_tokens':10,'completion_tokens':3,'total_tokens':13}})
        if data['model']=='response-tools':
            return self.send(200, {'choices':[{'message':{'role':'assistant','content':'Thinking','tool_calls':[{'id':'call_A','type':'function','function':{'name':'read','arguments':'{\"path\":\"a\"}'}},{'id':'call_B','type':'function','function':{'name':'write','arguments':'{}'}}]},'finish_reason':'tool_calls'}]})
        if data['model'] in ('response-stream','response-incomplete','response-truncated','response-stream-tools','response-stream-slow','response-stream-error'):
            def chunk(obj): return b'data: '+json.dumps(obj).encode()+b'\n\n'
            def choice(delta, finish=None): return {'choices':[{'index':0,'delta':delta,'finish_reason':finish}]}
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
            try:
                if data['model']=='response-stream-tools':
                    chunks=[choice({'tool_calls':[{'index':0,'id':'call_A','type':'function','function':{'name':'read','arguments':''}},{'index':1,'id':'call_B','type':'function','function':{'name':'write','arguments':''}}]}),choice({'tool_calls':[{'index':0,'function':{'arguments':'{\"p\":'}},{'index':1,'function':{'arguments':'{}'}}]}),choice({'tool_calls':[{'index':0,'function':{'arguments':'1}'}}]}),choice({},'tool_calls')]
                else: chunks=[choice({'role':'assistant','content':'Hello'}),choice({'content':' world'}),choice({},'length' if data['model']=='response-incomplete' else 'stop')]
                if data['model']=='response-stream-error': chunks=[choice({'content':'hello'}),{'error':{'message':'mock failure'}}]
                for index,c in enumerate(chunks):
                    self.wfile.write(chunk(c));self.wfile.flush()
                    if data['model']=='response-stream-slow' and index==0: time.sleep(.5)
                if data['model']!='response-truncated': self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError): pass
            self.close_connection=True
            return
        if data.get('stream') and data['model'] == 'delayed':
            self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.end_headers()
            try:
                self.wfile.write(b'data: {"choices":[]}\n\n'); self.wfile.flush(); time.sleep(.5)
                self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError): pass
            self.close_connection = True
            return
        if data.get('stream'):
            return self.send(200, b'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n', 'text/event-stream')
        self.send(200, {'object':'chat.completion','request':data,'choices':[{'message':{'role':'assistant','content':None,'tool_calls':[{'id':'call_1','type':'function','function':{'name':'read','arguments':'{}'}}]},'finish_reason':'tool_calls'}]})

class RoutedBackend(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *_): pass
    def do_POST(self):
        content=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        is_auth=self.headers.get('Authorization')=='Bearer route-secret'
        payload={'routed':True,'received':content,'choices':[{'message':{'role':'assistant','content':'routed response'},'finish_reason':'stop'}]}
        encoded=json.dumps(payload if is_auth else {'error':{'message':'bad route secret'}}).encode()
        self.send_response(200 if is_auth else 401)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

def request(port, method, path, body=None, key=KEY, headers=None):
    c=http.client.HTTPConnection('127.0.0.1',port,timeout=6)
    h=dict(headers or {})
    if key is not None: h['Authorization']='Bearer '+key
    if isinstance(body,dict): body=json.dumps(body); h['Content-Type']='application/json'
    c.request(method,path,body=body,headers=h); r=c.getresponse(); data=r.read(); result=(r.status,dict(r.getheaders()),data); c.close(); return result

class Integration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend=MockServer(('127.0.0.1',0),Backend)
        threading.Thread(target=cls.backend.serve_forever,daemon=True).start()
        cls.route_backend=MockServer(('127.0.0.1',0),RoutedBackend)
        threading.Thread(target=cls.route_backend.serve_forever,daemon=True).start()
        sock=socket.socket();sock.bind(('127.0.0.1',0));cls.port=sock.getsockname()[1];sock.close()
        cls.tmp=tempfile.TemporaryDirectory()
        with open(os.path.join(cls.tmp.name,'index.html'),'w') as f: f.write('console works')
        built_console=os.path.join(os.path.dirname(os.path.dirname(__file__)),'console','dist')
        cls.has_console=os.path.exists(os.path.join(built_console,'index.html'))
        assets=built_console if cls.has_console else cls.tmp.name
        env=dict(os.environ,YAG_BIND='127.0.0.1',YAG_PORT=str(cls.port),YAG_API_KEY=KEY,YAG_EXTRA_API_KEYS='additional-key-for-testing',YAG_UPSTREAM_KEY=UPKEY,YAG_ROUTE_SECRET='route-secret',YAG_MODEL_ROUTES=json.dumps([{'model':'routed-model','url':f'http://127.0.0.1:{cls.route_backend.server_port}/v1','key_env':'YAG_ROUTE_SECRET'}]),YAG_UPSTREAM_URL=f'http://127.0.0.1:{cls.backend.server_port}/v1',YAG_ASSETS=assets,YAG_TIMEOUT='1',NO_PROXY='127.0.0.1,localhost')
        cls.proc=subprocess.Popen([sys.argv[1]],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        for _ in range(100):
            if cls.proc.poll() is not None: raise RuntimeError(cls.proc.stderr.read().decode())
            try:
                if request(cls.port,'GET','/health',key=None)[0]==200: break
            except OSError: time.sleep(.03)
        else: raise RuntimeError('Host did not start')
    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate();cls.proc.wait(timeout=5);cls.proc.stderr.close();cls.backend.shutdown();cls.backend.server_close();cls.route_backend.shutdown();cls.route_backend.server_close();cls.tmp.cleanup()
    def test_health_and_console(self):
        self.assertEqual(request(self.port,'GET','/health',key=None)[0],200)
        page=request(self.port,'GET','/',key=None)[2]
        self.assertIn(b'id="root"' if self.has_console else b'console works',page)
        if self.has_console:
            js=re.search(rb'src="([^"]+\.js)"',page)
            self.assertIsNotNone(js)
            status,headers,_=request(self.port,'GET',js.group(1).decode(),key=None)
            self.assertEqual(status,200); self.assertIn('javascript',headers['Content-Type'])
        self.assertEqual(request(self.port,'GET','/../etc/passwd',key=None)[0],404)
    def test_auth_and_status(self):
        self.assertEqual(request(self.port,'GET','/v1/models',key=None)[0],401)
        self.assertEqual(request(self.port,'GET','/v1/models',key='wrong')[0],401)
        status,_,body=request(self.port,'GET','/api/status');self.assertEqual(status,200);self.assertGreaterEqual(json.loads(body)['active_connections'],1)
    def test_additional_api_key(self):
        self.assertEqual(request(self.port,'GET','/v1/models',key='additional-key-for-testing')[0],200)
        self.assertEqual(request(self.port,'GET','/v1/models',key='additional-key-for-testing-invalid')[0],401)
    def test_models(self):
        status,_,body=request(self.port,'GET','/v1/models');self.assertEqual(status,200);self.assertEqual(json.loads(body)['data'][0]['id'],'glm-test')
    def test_route_inventory_does_not_leak_secrets(self):
        status,_,data=request(self.port,'GET','/api/routes')
        self.assertEqual(status,200,data)
        self.assertEqual(json.loads(data)['data'],[{'model':'routed-model'}])
        self.assertNotIn(b'route-secret',data)
        self.assertEqual(request(self.port,'GET','/api/routes',key=None)[0],401)
    def test_model_routes_to_separate_backend(self):
        payload={'model':'routed-model','messages':[{'role':'user','content':'hello'}]}
        status,_,data=request(self.port,'POST','/v1/chat/completions',payload)
        self.assertEqual(status,200,data)
        result=json.loads(data)
        self.assertTrue(result['routed'])
        self.assertEqual(result['received'],payload)
    def test_tools_and_parameters_pass_through(self):
        payload={'model':'glm-test','messages':[{'role':'user','content':'hi'}],'tools':[{'type':'function','function':{'name':'read','parameters':{'type':'object'}}}],'temperature':0.4}
        status,_,body=request(self.port,'POST','/v1/chat/completions',payload); self.assertEqual(status,200); obj=json.loads(body);self.assertEqual(obj['request'],payload);self.assertEqual(obj['choices'][0]['message']['tool_calls'][0]['id'],'call_1')
    def test_streaming_tools(self):
        status,h,body=request(self.port,'POST','/v1/chat/completions',{'model':'glm-test','messages':[],'stream':True});self.assertEqual(status,200);self.assertIn('text/event-stream',h['Content-Type']);self.assertIn(b'call_1',body);self.assertIn(b'[DONE]',body)
    def test_stream_is_incremental(self):
        conn=http.client.HTTPConnection('127.0.0.1',self.port,timeout=4)
        payload=json.dumps({'model':'delayed','messages':[],'stream':True})
        start=time.monotonic(); conn.request('POST','/v1/chat/completions',payload,{'Authorization':'Bearer '+KEY,'Content-Type':'application/json'})
        response=conn.getresponse(); first=response.readline(); elapsed=time.monotonic()-start
        self.assertIn(b'data:',first); self.assertLess(elapsed,.4)
        self.assertIn(b'[DONE]',response.read()); conn.close()
    def test_bad_input(self):
        self.assertEqual(request(self.port,'POST','/v1/chat/completions','{')[0],400)
        self.assertEqual(request(self.port,'POST','/v1/chat/completions',{'model':'x'})[0],400)
        self.assertEqual(request(self.port,'POST','/v1/responses',{})[0],400)
        self.assertEqual(request(self.port,'POST','/v1/messages',{})[0],400)
    def test_upstream_error_and_timeout(self):
        status,_,body=request(self.port,'POST','/v1/chat/completions',{'model':'bad','messages':[]});self.assertEqual(status,429);self.assertEqual(json.loads(body)['error']['message'],'backend limit')
        status,_,_=request(self.port,'POST','/v1/chat/completions',{'model':'slow','messages':[]});self.assertEqual(status,504)
    def test_concurrency(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            results=list(pool.map(lambda _: request(self.port,'GET','/v1/models')[0],range(24)))
        self.assertEqual(results,[200]*24)
    def test_malformed_framing(self):
        s=socket.create_connection(('127.0.0.1',self.port)); s.sendall(b'POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\nContent-Length: 1\r\n\r\nx'); self.assertIn(b'400',s.recv(1024));s.close()
        s=socket.create_connection(('127.0.0.1',self.port));s.sendall(b'POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n');self.assertIn(b'400',s.recv(1024));s.close()
    def test_size_limit(self):
        s=socket.create_connection(('127.0.0.1',self.port))
        s.sendall(b'POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\nContent-Length: 1048577\r\n\r\n')
        self.assertIn(b'413',s.recv(1024)); s.close()
    def test_stream_disconnect(self):
        s=socket.create_connection(('127.0.0.1',self.port))
        body=b'{"model":"delayed","messages":[],"stream":true}'
        s.sendall(b'POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer '+KEY.encode()+b'\r\nContent-Length: '+str(len(body)).encode()+b'\r\n\r\n'+body)
        self.assertIn(b'200',s.recv(1024)); s.close()
        self.assertEqual(request(self.port,'GET','/health',key=None)[0],200)
    def test_chat_cancels_quiet_upstream(self):
        s=socket.create_connection(('127.0.0.1',self.port))
        body=b'{"model":"slow","messages":[]}'
        s.sendall(b'POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer '+KEY.encode()+b'\r\nContent-Length: '+str(len(body)).encode()+b'\r\n\r\n'+body)
        time.sleep(.1); s.close()
        deadline=time.monotonic()+.85
        count=None
        while time.monotonic()<deadline:
            count=json.loads(request(self.port,'GET','/api/status')[2])['active_connections']
            if count==1: break
            time.sleep(.05)
        self.assertEqual(count,1,'Chat upstream transfer did not cancel after disconnect')
    def test_disconnect(self):
        s=socket.create_connection(('127.0.0.1',self.port));s.sendall(b'POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\nContent-Length: 100\r\n\r\n{');s.close();self.assertEqual(request(self.port,'GET','/health',key=None)[0],200)
if __name__=='__main__':
    unittest.main(argv=[sys.argv[0]])
