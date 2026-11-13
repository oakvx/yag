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
        if self.path=='/v1/images/generations':
            return self.send(200,{'created':123,'data':[{'b64_json':'aW1hZ2U='}],
                                  'request':data})
        if self.path=='/v1/audio/speech':
            return self.send(200,b'ID3'+bytes([0,1,2,3]),'audio/mpeg')
        if self.path=='/v1/embeddings':
            if data['model']=='bad':
                return self.send(429,{'error':{'message':'embedding backend limit'}})
            return self.send(200,{
                'object':'list','data':[{'object':'embedding','index':0,
                                         'embedding':[0.125,-0.25,0.5]}],
                'model':data['model'],
                'usage':{'prompt_tokens':2,'total_tokens':2},
                'request':data})
        if self.path=='/v1/completions':
            if data.get('stream'):
                payload=(b'data: {"object":"text_completion","choices":'
                         b'[{"index":0,"text":"Hello","finish_reason":null}]}'
                         +bytes([10,10])+b'data: [DONE]'+bytes([10,10]))
                return self.send(200,payload,'text/event-stream')
            return self.send(200,{'object':'text_completion','model':data['model'],
                'choices':[{'text':'Hello','index':0,'finish_reason':'stop'}],
                'request':data})
        if data['model']=='slow': time.sleep(2); return self.send(200, {})
        if data['model']=='bad': return self.send(429, {'error':{'message':'backend limit'}})
        if data['model']=='anthropic-tools':
            return self.send(200, {'object':'chat.completion','choices':[{'message':{
                'role':'assistant','content':'I need the file',
                'tool_calls':[{'id':'call_read','type':'function',
                    'function':{'name':'read_file','arguments':'{"path":"src/main.c"}'}}]
                },'finish_reason':'tool_calls'}],
                'usage':{'prompt_tokens':15,'completion_tokens':7,'total_tokens':22}})
        if data['model']=='response-namespaced-tools':
            return self.send(200, {'object':'chat.completion',
                'choices':[{'message':{'role':'assistant','content':None,
                  'tool_calls':[{'id':'call_namespaced','type':'function',
                    'function':{'name':'workspace__read_file','arguments':'{"path":"README.md"}'}}]},
                  'finish_reason':'tool_calls'}],
                'usage':{'prompt_tokens':12,'completion_tokens':4,'total_tokens':16}})
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
    def do_GET(self):
        body=json.dumps({'object':'list','data':[{'id':'routed-model'}]}).encode()
        self.send_response(200 if self.headers.get('Authorization')=='Bearer route-secret' else 401)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        self.wfile.write(body)
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
        env=dict(os.environ,YAG_BIND='127.0.0.1',YAG_PORT=str(cls.port),YAG_API_KEY=KEY,YAG_EXTRA_API_KEYS='additional-key-for-testing,models-only-key-123456',YAG_EXTRA_KEY_SCOPES='all,models',YAG_UPSTREAM_KEY=UPKEY,YAG_ROUTE_SECRET='route-secret',YAG_MODEL_ROUTES=json.dumps([{'model':'routed-model','url':f'http://127.0.0.1:{cls.route_backend.server_port}/v1','key_env':'YAG_ROUTE_SECRET'}]),YAG_UPSTREAM_URL=f'http://127.0.0.1:{cls.backend.server_port}/v1',
                 YAG_MODEL_CAPABILITIES=json.dumps([
                     {'model':'glm-test','features':['streaming','function_tools'],'context_window':65536},
                     {'model':'routed-model','features':['streaming']}]),
                 YAG_ASSETS=assets,YAG_TIMEOUT='1',NO_PROXY='127.0.0.1,localhost')
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
    def test_assets_cannot_escape_root_through_symlinks(self):
        if self.has_console:
            self.skipTest('Asset root is the separately built Console')
        directory=os.path.join(self.tmp.name,'nested')
        os.makedirs(directory,exist_ok=True)
        with open(os.path.join(directory,'view.html'),'w') as f:
            f.write('safe nested asset')
        status,_,body=request(self.port,'GET','/nested/view.html',key=None)
        self.assertEqual(status,200,body)
        self.assertEqual(body,b'safe nested asset')
        outside=tempfile.NamedTemporaryFile(mode='wb',delete=False)
        try:
            outside.write(b'private fixture content')
            outside.close()
            os.symlink(outside.name,os.path.join(self.tmp.name,'public-leak.txt'))
            os.symlink(os.path.dirname(outside.name),os.path.join(self.tmp.name,'external-directory'))
            self.assertEqual(request(self.port,'GET','/public-leak.txt',key=None)[0],404)
            self.assertEqual(request(self.port,'GET','/external-directory/'+os.path.basename(outside.name),key=None)[0],404)
            self.assertEqual(request(self.port,'GET','/../private',key=None)[0],404)
        finally:
            os.unlink(outside.name)

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
    def test_unrecognized_paths_never_disclose_query_values_in_response(self):
        secret='a-private-token-never-log'
        status,_,body=request(self.port,'GET','/v1/unknown/'+secret+'?key='+secret)
        self.assertIn(status,(400,404))
        self.assertNotIn(secret.encode(),body)

    def test_auth_and_status(self):
        self.assertEqual(request(self.port,'GET','/v1/models',key=None)[0],401)
        self.assertEqual(request(self.port,'GET','/v1/models',key='wrong')[0],401)
        status,_,body=request(self.port,'GET','/api/status');self.assertEqual(status,200);self.assertGreaterEqual(json.loads(body)['active_connections'],1)
    def test_client_monitoring_is_scoped_and_never_leaks_credentials(self):
        self.assertEqual(request(self.port,'GET','/api/clients',key=None)[0],401)
        self.assertEqual(request(self.port,'GET','/api/clients',
            key='models-only-key-123456')[0],403)
        status,_,body=request(self.port,'GET','/api/clients')
        self.assertEqual(status,200,body)
        before=json.loads(body)
        self.assertEqual(before['object'],'gateway.clients')
        self.assertEqual(before['rate_limit_per_minute'],0)
        ids=[item['id'] for item in before['data']]
        self.assertEqual(ids,['primary','client-01','client-02'])
        self.assertEqual(before['data'][0]['scope'],'all')
        self.assertEqual(before['data'][1]['scope'],'all')
        self.assertEqual(before['data'][2]['scope'],'models')
        self.assertNotIn(KEY.encode(),body)
        self.assertNotIn(b'additional-key-for-testing',body)
        self.assertNotIn(b'models-only-key-123456',body)
        request(self.port,'GET','/v1/models',key='additional-key-for-testing')
        status,_,body=request(self.port,'GET','/api/clients')
        self.assertEqual(status,200,body)
        after=json.loads(body)
        self.assertEqual(after['data'][1]['accepted_requests'],
                         before['data'][1]['accepted_requests']+1)
        self.assertEqual(after['data'][1]['rate_limited_requests'],0)
        self.assertNotIn('api_key',str(after))

    def test_additional_api_key(self):
        self.assertEqual(request(self.port,'GET','/v1/models',key='additional-key-for-testing')[0],200)
        self.assertEqual(request(self.port,'GET','/v1/models',key='additional-key-for-testing-invalid')[0],401)
    def test_scoped_model_discovery_key_cannot_infer_or_monitor(self):
        key='models-only-key-123456'
        self.assertEqual(request(self.port,'GET','/v1/models',key=key)[0],200)
        self.assertEqual(request(self.port,'POST','/v1/chat/completions',
            {'model':'response-echo','messages':[]},key=key)[0],403)
        self.assertEqual(request(self.port,'GET','/api/metrics',key=key)[0],403)
        self.assertEqual(request(self.port,'POST','/api/provider/check',{},key=key)[0],403)
        self.assertEqual(request(self.port,'GET','/api/models/capabilities',key=key)[0],403)
        self.assertEqual(request(self.port,'GET','/api/providers/status',key=key)[0],403)
        self.assertEqual(request(self.port,'POST','/v1/messages',
            {'model':'response-echo','max_tokens':32,
             'messages':[{'role':'user','content':'test'}]},key=None,
            headers={'X-API-Key':key})[0],403)

    def test_invalid_scope_policy_fails_startup(self):
        # 'models,all' is valid: there are two extra keys and two known scopes.
        # The extra third scope below must fail the positional count check.
        for scopes in ['bad','models,all,monitor','models,','all,invalid']:
            env=dict(os.environ,YAG_API_KEY=KEY,
                YAG_EXTRA_API_KEYS='extra-one-key-123456,extra-two-key-123456',
                YAG_EXTRA_KEY_SCOPES=scopes)
            outcome=subprocess.run([sys.argv[1]],env=env,capture_output=True,timeout=2)
            self.assertNotEqual(outcome.returncode,0,scopes)
            self.assertIn(b'YAG_EXTRA_KEY_SCOPES',outcome.stderr)

    def test_duplicate_api_keys_are_rejected(self):
        # The same secret must never acquire a different privilege because
        # it appears again in a later positional scope entry.
        duplicate_extra='repeated-extra-key-12345'
        cases=[
            (KEY,'models'),
            (f'{duplicate_extra},{duplicate_extra}','models,all'),
        ]
        for extra_keys,scopes in cases:
            with self.subTest(scopes=scopes):
                env=dict(os.environ,YAG_API_KEY=KEY,
                    YAG_EXTRA_API_KEYS=extra_keys,
                    YAG_EXTRA_KEY_SCOPES=scopes)
                outcome=subprocess.run([sys.argv[1]],env=env,
                    capture_output=True,timeout=2)
                self.assertNotEqual(outcome.returncode,0)
                self.assertIn(b'YAG_EXTRA_API_KEYS',outcome.stderr)

    def test_valid_scope_policy_starts_and_enforces_permissions(self):
        # Isolate this subprocess from the fixture gateway's listening port.
        # A valid policy should start, not hang in a test expecting an exit.
        with socket.socket() as listener:
            listener.bind(('127.0.0.1',0))
            port=listener.getsockname()[1]
        models_key='models-only-extra-12345'
        all_key='full-access-extra-12345'
        env=dict(os.environ,YAG_API_KEY=KEY,YAG_BIND='127.0.0.1',
            YAG_PORT=str(port),YAG_EXTRA_API_KEYS=f'{models_key},{all_key}',
            YAG_EXTRA_KEY_SCOPES='models,all',
            YAG_UPSTREAM_URL=f'http://127.0.0.1:{self.backend.server_port}/v1',
            YAG_UPSTREAM_KEY=UPKEY,NO_PROXY='127.0.0.1,localhost')
        proc=subprocess.Popen([sys.argv[1]],env=env,
            stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        try:
            for _ in range(100):
                if proc.poll() is not None:
                    self.fail('Valid scope policy rejected: '+
                        proc.stderr.read().decode(errors='replace'))
                try:
                    if request(port,'GET','/health',key=None)[0]==200:
                        break
                except OSError:
                    time.sleep(.03)
            else:
                self.fail('Gateway did not start with valid scopes')
            self.assertEqual(request(port,'GET','/v1/models',key=models_key)[0],200)
            self.assertEqual(request(port,'GET','/api/metrics',key=models_key)[0],403)
            self.assertEqual(request(port,'GET','/v1/models',key=all_key)[0],200)
            self.assertEqual(request(port,'GET','/api/metrics',key=all_key)[0],200)
        finally:
            if proc.poll() is None:
                proc.terminate()
            proc.wait(timeout=5)
            proc.stderr.close()

    def test_models(self):
        status,_,body=request(self.port,'GET','/v1/models');self.assertEqual(status,200);self.assertEqual(json.loads(body)['data'][0]['id'],'glm-test')
    def test_get_model_details_uses_merged_inventory_and_models_scope(self):
        for model,owner in [('glm-test','local'),
                            ('routed-model','yag-configured-route')]:
            with self.subTest(model=model):
                path='/v1/models/'+model
                status,_,body=request(self.port,'GET',path)
                self.assertEqual(status,200,body)
                details=json.loads(body)
                self.assertEqual(details['id'],model)
                self.assertEqual(details['object'],'model')
                self.assertEqual(details['owned_by'],owner)
                self.assertEqual(request(self.port,'GET',path,
                    key='models-only-key-123456')[0],200)
                self.assertEqual(request(self.port,'GET',path,key=None)[0],401)
        self.assertEqual(request(self.port,'GET','/v1/models/non-existent')[0],404)
        self.assertEqual(request(self.port,'GET','/v1/models/')[0],404)
        self.assertNotIn(b'route-secret',
            request(self.port,'GET','/v1/models/routed-model')[2])

    def test_route_inventory_does_not_leak_secrets(self):
        status,_,data=request(self.port,'GET','/api/routes')
        self.assertEqual(status,200,data)
        self.assertEqual(json.loads(data)['data'],[{'model':'routed-model'}])
        self.assertNotIn(b'route-secret',data)
        self.assertEqual(request(self.port,'GET','/api/routes',key=None)[0],401)
    def test_only_upstream_reported_tokens_are_aggregated(self):
        def usage():
            data=json.loads(request(self.port,'GET','/api/providers/status')[2])
            return data['data'][0]
        before=usage()
        self.assertEqual(request(self.port,'POST','/v1/chat/completions',{
            'model':'response-echo','messages':[{'role':'user','content':'fixture'}]})[0],200)
        self.assertEqual(request(self.port,'POST','/v1/responses',{
            'model':'response-echo','input':'fixture'})[0],200)
        self.assertEqual(request(self.port,'POST','/v1/messages',{
            'model':'response-echo','max_tokens':32,'messages':[
                {'role':'user','content':'fixture'}]})[0],200)
        after=usage()
        self.assertEqual(after['prompt_tokens']-before['prompt_tokens'],30)
        self.assertEqual(after['completion_tokens']-before['completion_tokens'],9)
        self.assertEqual(after['usage_samples']-before['usage_samples'],3)
        self.assertGreaterEqual(after['total_latency_ms'],before['total_latency_ms'])
        self.assertNotIn('fixture',str(after))
        self.assertEqual(request(self.port,'POST','/v1/responses',{
            'model':'response-stream','input':'fixture','stream':True})[0],200)
        self.assertEqual(usage()['usage_samples'],after['usage_samples'])

    def test_declarative_model_capabilities_are_explicitly_unverified(self):
        status,_,body=request(self.port,'GET','/api/models/capabilities')
        self.assertEqual(status,200,body)
        listed=json.loads(body)
        self.assertEqual(listed['object'],'gateway.model_capabilities')
        self.assertFalse(listed['verified'])
        self.assertEqual([m['model'] for m in listed['data']],['glm-test','routed-model'])
        self.assertEqual(listed['data'][0]['features'],['streaming','function_tools'])
        self.assertEqual(listed['data'][0]['context_window'],65536)
        self.assertIsNone(listed['data'][1]['context_window'])
        self.assertFalse(listed['data'][0]['verified'])
        self.assertNotIn(b'upstream-secret',body)
        self.assertNotIn(b'route-secret',body)
        self.assertEqual(request(self.port,'GET','/api/models/capabilities',key=None)[0],401)

    def test_model_capability_configuration_is_strict(self):
        for entry in [
            [{'model':'x','features':['unknown']}],
            [{'model':'x','features':['streaming','streaming']}],
            [{'model':'x','features':[],'context_window':20}],
            [{'model':'x','features':[]},{'model':'x','features':[]}],
            [{'model':'x','features':[],'key':'do-not-expose'}],
        ]:
            env=dict(os.environ,YAG_API_KEY=KEY,
                YAG_MODEL_CAPABILITIES=json.dumps(entry))
            completed=subprocess.run([sys.argv[1]],env=env,
                capture_output=True,timeout=2)
            self.assertNotEqual(completed.returncode,0,entry)
            self.assertIn(b'YAG_MODEL_CAPABILITIES',completed.stderr)

    def test_model_routes_to_separate_backend(self):
        payload={'model':'routed-model','messages':[{'role':'user','content':'hello'}]}
        status,_,data=request(self.port,'POST','/v1/chat/completions',payload)
        self.assertEqual(status,200,data)
        result=json.loads(data)
        self.assertTrue(result['routed'])
        self.assertEqual(result['received'],payload)
    def test_inference_counters_are_payload_free(self):
        self.assertEqual(request(self.port,'POST','/v1/chat/completions',
            {'model':'response-echo','messages':[{'role':'user','content':'secret-prompt'}]})[0],200)
        status,_,body=request(self.port,'GET','/api/metrics')
        self.assertEqual(status,200,body)
        data=json.loads(body)
        self.assertEqual(data['object'],'gateway.metrics')
        self.assertGreaterEqual(data['chat_requests'],1)
        self.assertEqual(data['responses_requests'],int(data['responses_requests']))
        self.assertNotIn(b'secret-prompt',body)
        self.assertEqual(request(self.port,'GET','/api/metrics',key=None)[0],401)

    def test_universal_api_capabilities_and_metrics(self):
        status,_,body=request(self.port,'GET','/api/capabilities')
        self.assertEqual(status,200,body)
        protocols=json.loads(body)['protocols']
        self.assertEqual(protocols['embeddings']['mode'],'upstream_passthrough')
        self.assertEqual(protocols['completions']['mode'],'upstream_passthrough')
        self.assertTrue(protocols['completions']['streaming'])
        before=json.loads(request(self.port,'GET','/api/metrics')[2])
        request(self.port,'POST','/v1/embeddings',{'model':'glm-test','input':'a'})
        request(self.port,'POST','/v1/completions',{'model':'glm-test','prompt':'a'})
        after=json.loads(request(self.port,'GET','/api/metrics')[2])
        self.assertEqual(after['embeddings_requests']-before['embeddings_requests'],1)
        self.assertEqual(after['completions_requests']-before['completions_requests'],1)
        self.assertNotIn('prompt',after)
        self.assertNotIn('input',after)

    def test_capabilities_contract_does_not_confuse_gateway_with_model_support(self):
        status,_,body=request(self.port,'GET','/api/capabilities')
        self.assertEqual(status,200,body)
        caps=json.loads(body)
        self.assertEqual(caps['object'],'gateway.capabilities')
        self.assertEqual(caps['routing']['configured_routes'],1)
        self.assertFalse(caps['routing']['fallback_enabled'])
        self.assertFalse(caps['protocols']['responses']['web_search'])
        self.assertFalse(caps['protocols']['responses']['stateful'])
        self.assertFalse(caps['protocols']['anthropic_messages']['multimodal'])
        self.assertTrue(caps['protocols']['anthropic_messages']['streaming'])
        self.assertEqual(caps['limits']['max_body_bytes'],1024*1024)
        self.assertNotIn(b'route-secret',body)
        self.assertNotIn(b'127.0.0.1',body)
        self.assertEqual(request(self.port,'GET','/api/capabilities',key=None)[0],401)

    def test_provider_reachability_checks_do_not_disclose_secrets(self):
        for payload in [{},{'model':'routed-model'}]:
            status,_,body=request(self.port,'POST','/api/provider/check',payload)
            self.assertEqual(status,200,body)
            result=json.loads(body)
            self.assertTrue(result['reachable'])
            self.assertEqual(result['upstream_status'],200)
            self.assertNotIn(b'route-secret',body)
            self.assertNotIn(b'127.0.0.1',body)
        self.assertEqual(request(self.port,'POST','/api/provider/check',{'model':'absent'})[0],404)
        self.assertEqual(request(self.port,'POST','/api/provider/check',{'model':'routed-model'},key=None)[0],401)

    def test_aggregate_model_list_includes_static_routes(self):
        status,_,body=request(self.port,'GET','/v1/models')
        self.assertEqual(status,200,body)
        models={item['id']:item for item in json.loads(body)['data']}
        self.assertIn('glm-test',models)
        self.assertEqual(models['glm-test']['owned_by'],'local')
        self.assertIn('routed-model',models)
        self.assertEqual(models['routed-model']['owned_by'],'yag-configured-route')
        self.assertNotIn('route-secret',body.decode())

    def test_embeddings_proxy_and_route_selection(self):
        payload={'model':'glm-test','input':['first','second'],
                 'encoding_format':'float'}
        status,headers,body=request(self.port,'POST','/v1/embeddings',payload)
        self.assertEqual(status,200,body)
        response=json.loads(body)
        self.assertEqual(response['object'],'list')
        self.assertEqual(response['data'][0]['embedding'],[0.125,-0.25,0.5])
        self.assertEqual(response['request'],payload)
        self.assertEqual(response['usage']['total_tokens'],2)
        self.assertIn('application/json',headers['Content-Type'])
        routed={'model':'routed-model','input':'test'}
        status,_,body=request(self.port,'POST','/v1/embeddings',routed)
        self.assertEqual(status,200,body)
        self.assertTrue(json.loads(body)['routed'])
        self.assertEqual(json.loads(body)['received'],routed)
        self.assertEqual(request(self.port,'POST','/v1/embeddings',
            {'model':'bad','input':'hello'})[0],429)

    def test_embeddings_require_valid_payload_and_inference_scope(self):
        invalid=[{},[],{'model':'glm-test'},{'model':'','input':'hello'},
                 {'model':'glm-test','input':''},
                 {'model':'glm-test','input':[]},
                 {'model':'glm-test','input':17},
                 {'model':12,'input':'hello'}]
        for payload in invalid:
            with self.subTest(payload=payload):
                self.assertEqual(request(self.port,'POST','/v1/embeddings',
                    payload)[0],400)
        valid={'model':'glm-test','input':'hello'}
        self.assertEqual(request(self.port,'POST','/v1/embeddings',
            valid,key=None)[0],401)
        self.assertEqual(request(self.port,'POST','/v1/embeddings',
            valid,key='models-only-key-123456')[0],403)
        self.assertEqual(request(self.port,'GET','/v1/embeddings')[0],404)

    def test_legacy_completions_proxy_streaming_and_routing(self):
        payload={'model':'glm-test','prompt':'Say hello','temperature':0.2}
        status,_,body=request(self.port,'POST','/v1/completions',payload)
        self.assertEqual(status,200,body)
        response=json.loads(body)
        self.assertEqual(response['object'],'text_completion')
        self.assertEqual(response['choices'][0]['text'],'Hello')
        self.assertEqual(response['request'],payload)
        stream=dict(payload,stream=True)
        status,headers,body=request(self.port,'POST','/v1/completions',stream)
        self.assertEqual(status,200,body)
        self.assertIn('text/event-stream',headers['Content-Type'])
        self.assertIn(b'data: [DONE]',body)
        routed={'model':'routed-model','prompt':'Hello'}
        status,_,body=request(self.port,'POST','/v1/completions',routed)
        self.assertEqual(status,200,body)
        self.assertEqual(json.loads(body)['received'],routed)

    def test_legacy_completions_validate_and_authenticate(self):
        invalid=[{}, {'model':'glm-test'}, {'model':'','prompt':'hi'},
                 {'model':'glm-test','prompt':''},
                 {'model':'glm-test','prompt':[]},
                 {'model':'glm-test','prompt':False},
                 {'model':1,'prompt':'hi'}]
        for payload in invalid:
            with self.subTest(payload=payload):
                self.assertEqual(request(self.port,'POST','/v1/completions',
                    payload)[0],400)
        valid={'model':'glm-test','prompt':'Hello'}
        self.assertEqual(request(self.port,'POST','/v1/completions',
            valid,key=None)[0],401)
        self.assertEqual(request(self.port,'POST','/v1/completions',
            valid,key='models-only-key-123456')[0],403)
        self.assertEqual(request(self.port,'GET','/v1/completions')[0],404)

    def test_image_and_speech_generation_passthrough(self):
        image={'model':'glm-test','prompt':'A small green tree','size':'256x256'}
        status,headers,body=request(self.port,'POST','/v1/images/generations',image)
        self.assertEqual(status,200,body)
        self.assertEqual(json.loads(body)['request'],image)
        self.assertEqual(json.loads(body)['data'][0]['b64_json'],'aW1hZ2U=')
        speech={'model':'glm-test','input':'Hello','voice':'alloy',
                'response_format':'mp3'}
        status,headers,body=request(self.port,'POST','/v1/audio/speech',speech)
        self.assertEqual(status,200,body)
        self.assertIn('audio/mpeg',headers['Content-Type'])
        self.assertEqual(body,b'ID3'+bytes([0,1,2,3]))
        for path,payload in [
            ('/v1/images/generations',{'model':'glm-test'}),
            ('/v1/images/generations',{'model':'','prompt':'hello'}),
            ('/v1/audio/speech',{'model':'glm-test','input':'hello'}),
            ('/v1/audio/speech',{'model':'glm-test','input':'','voice':'alloy'}),
        ]:
            with self.subTest(path=path,payload=payload):
                self.assertEqual(request(self.port,'POST',path,payload)[0],400)
        self.assertEqual(request(self.port,'POST','/v1/images/generations',image,
                                 key='models-only-key-123456')[0],403)
        self.assertEqual(request(self.port,'POST','/v1/audio/speech',speech,
                                 key=None)[0],401)
        status,_,body=request(self.port,'GET','/api/capabilities')
        protocols=json.loads(body)['protocols']
        self.assertIn('image_generations',protocols)
        self.assertIn('audio_speech',protocols)

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
    def test_auth_rejects_unfinished_request_body_immediately(self):
        s=socket.create_connection(('127.0.0.1',self.port),timeout=1)
        try:
            s.sendall(b'POST /v1/chat/completions HTTP/1.1\r\n'
                      b'Host: localhost\r\nContent-Length: 800000\r\n\r\n')
            answer=s.recv(1024)
            self.assertIn(b'401',answer)
        finally:
            s.close()

    def test_malformed_framing(self):
        s=socket.create_connection(('127.0.0.1',self.port)); s.sendall(b'POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\nContent-Length: 1\r\n\r\nx'); self.assertIn(b'400',s.recv(1024));s.close()
        s=socket.create_connection(('127.0.0.1',self.port));s.sendall(b'POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n');self.assertIn(b'400',s.recv(1024));s.close()
    def test_invalid_header_names_are_rejected(self):
        for extra in [b'Content-Length : 1',b'X Token: test',b'X\\x01Bad: test']:
            s=socket.create_connection(('127.0.0.1',self.port),timeout=2)
            try:
                s.sendall(b'POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\n'
                          b'Authorization: Bearer '+KEY.encode()+b'\r\n'+extra+b'\r\n\r\n')
                self.assertIn(b'400',s.recv(1024),extra)
            finally:s.close()

    def test_expect_100_continue_after_authentication(self):
        payload=b'{"model":"response-echo","messages":[{"role":"user","content":"ok"}]}'
        def exchange(key,expect):
            s=socket.create_connection(('127.0.0.1',self.port),timeout=3)
            try:
                s.sendall(b'POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\n'
                    b'Authorization: Bearer '+key+b'\r\n'
                    b'Expect: '+expect+b'\r\nContent-Length: '+str(len(payload)).encode()+b'\r\n\r\n')
                reply=s.recv(1024)
                if reply.startswith(b'HTTP/1.1 100'):
                    s.sendall(payload)
                    reply=s.recv(2048)
                return reply
            finally:s.close()
        self.assertIn(b'200',exchange(KEY.encode(),b'100-continue'))
        self.assertIn(b'401',exchange(b'wrong',b'100-continue'))
        self.assertIn(b'417',exchange(KEY.encode(),b'invalid'))

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
