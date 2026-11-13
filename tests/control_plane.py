#!/usr/bin/env python3
"""Control plane end-to-end coverage against deterministic local Ollama replicas."""
import concurrent.futures
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler

from integration import Backend, KEY, MockServer, UPKEY, request

CLIENT_KEY = 'control-plane-client-123456789'
SCOPE = 'inference+models'


class OllamaMock(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args):pass
    def respond(self,code,data):
        encoded=json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)
    def do_GET(self):
        if self.path=='/api/tags':
            return self.respond(200,{'models':[{'name':'llama3.2','size':2000000000}]})
        if self.path=='/api/ps':
            return self.respond(200,{'models':[{'name':'llama3.2','size_vram':1000000000}]})
        self.respond(404,{'error':'unknown Ollama endpoint'})
    def do_POST(self):
        payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path=='/api/pull' and payload.get('stream') is False:
            time.sleep(.2)
            return self.respond(200,{'status':'success'})
        self.respond(404,{'error':'unsupported'})
    def do_DELETE(self):
        payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path=='/api/delete' and payload.get('name'):
            return self.respond(200,{'status':'success'})
        self.respond(404,{'error':'unknown'})


class ReplicaMock(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args):pass
    def do_POST(self):
        request_body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        data=json.dumps({'source':'replica','request':request_body}).encode()
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class ControlPlane(unittest.TestCase):
    @classmethod
    def launch(cls):
        env=dict(os.environ,
            YAG_BIND='127.0.0.1',
            YAG_PORT=str(cls.port),
            YAG_API_KEY=KEY,
            YAG_EXTRA_API_KEYS=CLIENT_KEY,
            YAG_EXTRA_KEY_SCOPES=SCOPE,
            YAG_UPSTREAM_KEY=UPKEY,
            YAG_UPSTREAM_URL='http://127.0.0.1:'+str(cls.backend.server_port)+'/v1',
            YAG_OLLAMA_ADMIN_URL='http://127.0.0.1:'+str(cls.ollama.server_port),
            YAG_CLIENT_STORE=str(Path(cls.tmp.name)/'clients.json'),
            YAG_UPSTREAM_POOL=json.dumps([{'url':'http://127.0.0.1:'+
                                           str(cls.replica.server_port)+'/v1'}]),
            YAG_MAX_INFERENCE='2',YAG_MAX_INFERENCE_PER_KEY='1',
            YAG_INFERENCE_QUEUE_WAIT_MS='500',NO_PROXY='127.0.0.1,localhost')
        cls.proc=subprocess.Popen([cls.binary],env=env,
                                  stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        for _ in range(100):
            if cls.proc.poll() is not None:
                raise RuntimeError(cls.proc.stderr.read().decode())
            try:
                if request(cls.port,'GET','/health',key=None)[0]==200:return
            except OSError:time.sleep(.03)
        raise RuntimeError('YAG did not start')

    @classmethod
    def setUpClass(cls):
        cls.backend=MockServer(('127.0.0.1',0),Backend)
        cls.ollama=MockServer(('127.0.0.1',0),OllamaMock)
        cls.replica=MockServer(('127.0.0.1',0),ReplicaMock)
        for backend in (cls.backend,cls.ollama,cls.replica):
            threading.Thread(target=backend.serve_forever,daemon=True).start()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0))
            cls.port=sock.getsockname()[1]
        cls.tmp=tempfile.TemporaryDirectory()
        cls.binary=sys.argv[1]
        cls.launch()

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=10)
        cls.proc.stderr.close()
        for backend in (cls.backend,cls.ollama,cls.replica):
            backend.shutdown();backend.server_close()
        cls.tmp.cleanup()

    def test_admin_only_client_creation_and_scopes(self):
        valid={'name':'Studio PC','scope':'inference+models'}
        self.assertEqual(request(self.port,'POST','/api/admin/clients',valid,
                                 key=CLIENT_KEY)[0],403)
        status,_,body=request(self.port,'POST','/api/admin/clients',valid)
        self.assertEqual(status,201,body)
        info=json.loads(body)
        self.assertGreaterEqual(len(info['api_key']),32)
        client_id=info['id']
        token=info['api_key']
        self.assertEqual(request(self.port,'GET','/v1/models',key=token)[0],200)
        self.assertEqual(request(self.port,'GET','/api/admin/clients',key=token)[0],403)
        status,_,body=request(self.port,'GET','/api/admin/clients')
        self.assertEqual(status,200,body)
        self.assertNotIn(token.encode(),body)
        self.assertIn('Studio PC',body.decode())
        self.assertEqual(request(self.port,'POST','/api/admin/clients/rename',
                                 {'id':client_id,'name':'Renamed PC'})[0],200)
        self.assertEqual(request(self.port,'POST','/api/admin/clients/disable',
                                 {'id':client_id})[0],200)
        self.assertEqual(request(self.port,'GET','/v1/models',key=token)[0],401)
        self.assertEqual(request(self.port,'POST','/api/admin/clients/enable',
                                 {'id':client_id})[0],200)
        self.assertEqual(request(self.port,'GET','/v1/models',key=token)[0],200)
        self.assertEqual(request(self.port,'POST','/api/admin/clients/revoke',
                                 {'id':client_id})[0],200)
        self.assertEqual(request(self.port,'GET','/v1/models',key=token)[0],401)
        self.assertNotIn(token,Path(self.tmp.name,'clients.json').read_text())

    def test_admin_rejects_invalid_requests(self):
        self.assertEqual(request(self.port,'POST','/api/admin/clients',
            {'name':'bad<script>','scope':'all'})[0],400)
        self.assertEqual(request(self.port,'POST','/api/admin/clients',
            {'name':'admin','scope':'all'})[0],400)
        self.assertEqual(request(self.port,'POST','/api/admin/clients/revoke',
            {'id':999})[0],400)
        self.assertEqual(request(self.port,'POST','/api/admin/clients/rename',
            {'id':1,'name':'<img>'})[0],400)
        self.assertEqual(request(self.port,'GET','/api/admin/ollama/models',
            key=CLIENT_KEY)[0],403)

    def test_ollama_install_list_job_and_delete(self):
        status,_,body=request(self.port,'GET','/api/admin/ollama/models')
        self.assertEqual(status,200,body)
        self.assertEqual(json.loads(body)['models'][0]['name'],'llama3.2')
        status,_,body=request(self.port,'GET','/api/admin/ollama/loaded')
        self.assertEqual(status,200,body)
        self.assertEqual(json.loads(body)['models'][0]['size_vram'],1000000000)
        self.assertEqual(request(self.port,'POST','/api/admin/ollama/pull',
            {'name':'invalid model with spaces'})[0],400)
        status,_,body=request(self.port,'POST','/api/admin/ollama/pull',
            {'name':'llama3.2'})
        self.assertEqual(status,202,body)
        for _ in range(50):
            job=json.loads(request(self.port,'GET','/api/admin/ollama/jobs')[2])
            if job['status']!='running':break
            time.sleep(.04)
        self.assertEqual(job['status'],'completed',job)
        self.assertEqual(request(self.port,'POST','/api/admin/ollama/delete',
            {'name':'llama3.2'})[0],200)

    def test_replica_round_robin_and_status(self):
        seen=set()
        for _ in range(6):
            status,_,body=request(self.port,'POST','/v1/chat/completions',
                {'model':'glm-test','messages':[]})
            self.assertEqual(status,200,body)
            obj=json.loads(body)
            seen.add(obj.get('source','default'))
        self.assertEqual(seen,{'default','replica'})
        status,_,body=request(self.port,'GET','/api/providers/pool')
        self.assertEqual(status,200,body)
        rows=json.loads(body)['data']
        self.assertEqual(len(rows),2)
        self.assertGreaterEqual(sum(x['attempts'] for x in rows),6)
        self.assertNotIn(str(self.replica.server_port).encode(),body)

    def test_scheduler_enforces_per_key_admission(self):
        payload={'model':'slow','messages':[]}
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            first=pool.submit(request,self.port,'POST','/v1/chat/completions',payload)
            time.sleep(.15)
            status,headers,body=request(self.port,'POST',
                '/v1/chat/completions',payload)
            self.assertEqual(status,429,body)
            self.assertEqual(headers.get('Retry-After'),'1')
            running=json.loads(request(self.port,'GET','/api/scheduler')[2])
            self.assertEqual(running['max_per_key'],1)
            self.assertGreaterEqual(running['active'],1)
            self.assertEqual(first.result(timeout=7)[0],200)

    def test_container_scoped_telemetry(self):
        status,_,body=request(self.port,'GET','/api/system/resources')
        self.assertEqual(status,200,body)
        data=json.loads(body)
        self.assertEqual(data['scope'],'gateway_container')
        self.assertIn('cpu',data)
        self.assertIn('memory',data)
        self.assertEqual(data['gpu']['available'],False)
        self.assertEqual(request(self.port,'GET','/api/system/resources',
            key=CLIENT_KEY)[0],403)

    def test_z_registry_survives_clean_restart(self):
        status,_,body=request(self.port,'POST','/api/admin/clients',
            {'name':'Persistent PC','scope':SCOPE})
        self.assertEqual(status,201,body)
        info=json.loads(body)
        cls=type(self)
        cls.proc.terminate();cls.proc.wait(timeout=10);cls.proc.stderr.close()
        cls.launch()
        self.assertEqual(request(self.port,'GET','/v1/models',
            key=info['api_key'])[0],200)
        self.assertEqual(request(self.port,'POST','/api/admin/clients/revoke',
            {'id':info['id']})[0],200)


if __name__=='__main__':
    unittest.main(argv=[sys.argv[0]])
