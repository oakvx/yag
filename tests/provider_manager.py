#!/usr/bin/env python3
"""Live provider administration, private persistence and model probe regression."""
import concurrent.futures
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler

from integration import Backend, KEY, MockServer, UPKEY, request

REPLICA_KEY="testing-replica-key-1234"
LOCAL_ONLY_KEY="local-client-no-cloud-key-12345"


class ProviderMock(BaseHTTPRequestHandler):
    protocol_version="HTTP/1.1"
    def log_message(self,*args):pass
    def send_json(self,code,data):
        encoded=json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)
    def do_GET(self):
        if self.headers.get("Authorization")!="Bearer "+REPLICA_KEY:
            return self.send_json(401,{"error":"unauthorized"})
        if self.path=="/v1/models":
            return self.send_json(200,{"object":"list","data":[{"id":"managed-model"}]})
        self.send_json(404,{"error":"unknown"})
    def do_POST(self):
        if self.headers.get("Authorization")!="Bearer "+REPLICA_KEY:
            return self.send_json(401,{"error":"unauthorized"})
        payload=json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if payload.get("model")=="slow":
            time.sleep(1.3)
        self.send_json(200,{"source":"managed-replica","request":payload})


class ProviderManager(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.binary=sys.argv[1]
        cls.tmp=tempfile.TemporaryDirectory()
        cls.store=Path(cls.tmp.name)/"providers.json"
        cls.backend=MockServer(("127.0.0.1",0),Backend)
        cls.replica=MockServer(("127.0.0.1",0),ProviderMock)
        for server in (cls.backend,cls.replica):
            threading.Thread(target=server.serve_forever,daemon=True).start()
        with socket.socket() as s:
            s.bind(("127.0.0.1",0));cls.port=s.getsockname()[1]
        cls.url="http://127.0.0.1:"+str(cls.replica.server_port)+"/v1"
        cls.env=dict(os.environ,
            YAG_API_KEY=KEY,
            YAG_BIND="127.0.0.1",
            YAG_PORT=str(cls.port),
            YAG_UPSTREAM_URL="http://127.0.0.1:"+str(cls.backend.server_port)+"/v1",
            YAG_UPSTREAM_KEY=UPKEY,
            YAG_PROVIDER_STORE=str(cls.store),
            YAG_CLIENT_STORE=str(Path(cls.tmp.name)/"clients.json"),
            YAG_EXTRA_API_KEYS=LOCAL_ONLY_KEY,
            YAG_EXTRA_KEY_SCOPES="inference+models",
            YAG_POOL_KEY_1=REPLICA_KEY,
            YAG_UPSTREAM_POOL="[]",
            YAG_MAX_INFERENCE="4",
            YAG_FALLBACK_TO_DEFAULT="1",
            YAG_MAX_INFERENCE_PER_KEY="4",
            NO_PROXY="127.0.0.1,localhost")
        cls.launch()

    @classmethod
    def launch(cls):
        cls.proc=subprocess.Popen([cls.binary],env=cls.env,
            stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        for _ in range(100):
            if cls.proc.poll() is not None:
                raise RuntimeError(cls.proc.stderr.read().decode())
            try:
                if request(cls.port,"GET","/health",key=None)[0]==200:return
            except OSError:time.sleep(.03)
        raise RuntimeError("Provider manager gateway failed to start")

    @classmethod
    def tearDownClass(cls):
        if cls.proc.poll() is None:cls.proc.terminate()
        cls.proc.wait(timeout=10);cls.proc.stderr.close()
        for server in (cls.backend,cls.replica):
            server.shutdown();server.server_close()
        cls.tmp.cleanup()

    def apply(self,replicas):
        return request(self.port,"POST","/api/admin/providers/apply",
                       {"replicas":replicas})

    def test_01_primary_only_and_authorization(self):
        status,_,body=request(self.port,"GET","/api/admin/providers")
        self.assertEqual(status,200,body)
        self.assertEqual(json.loads(body)["data"],[])
        self.assertTrue(json.loads(body)["editable"])
        self.assertEqual(request(self.port,"POST","/api/admin/providers/apply",
              {"replicas":[]},key="invalid-credential")[0],401)
        self.assertEqual(request(self.port,"POST","/api/admin/providers/apply",
              {"replicas":[]},key="this-user-does-not-have-admin")[0],401)

    def test_02_add_route_probe_and_secret_redaction(self):
        entry={"url":self.url,"key_env":"YAG_POOL_KEY_1",
               "models":["managed-model"],"enabled":True,"priority":7}
        code,_,body=self.apply([entry])
        self.assertEqual(code,200,body)
        self.assertTrue(json.loads(body)["persisted"])
        self.assertEqual(stat.S_IMODE(self.store.stat().st_mode),0o600)
        text=self.store.read_text()
        self.assertIn("YAG_POOL_KEY_1",text)
        self.assertNotIn(REPLICA_KEY,text)
        self.assertNotIn(KEY,text)
        code,_,body=request(self.port,"GET","/api/admin/providers")
        self.assertEqual(code,200,body)
        data=json.loads(body)["data"]
        self.assertEqual(len(data),1)
        self.assertEqual(data[0]["priority"],7)
        self.assertEqual(data[0]["models"],["managed-model"])
        self.assertNotIn(REPLICA_KEY,body.decode())
        code,_,body=request(self.port,"POST","/api/admin/providers/check",{"index":1})
        self.assertEqual(code,200,body)
        health=json.loads(body)
        self.assertTrue(health["available"],health)
        self.assertEqual(health["models"],["managed-model"])
        self.assertNotIn(REPLICA_KEY,body.decode())
        seen=set()
        for _ in range(5):
            code,_,body=request(self.port,"POST","/v1/chat/completions",
                                {"model":"managed-model","messages":[]})
            self.assertEqual(code,200,body)
            seen.add(json.loads(body).get("source","primary"))
        self.assertIn("managed-replica",seen)
        code,_,body=request(self.port,"GET","/api/providers/pool")
        self.assertEqual(code,200,body)
        self.assertNotIn(self.url.encode(),body)
        self.assertNotIn(REPLICA_KEY.encode(),body)

    def test_03_disable_and_invalid_apply_are_transactional(self):
        entry={"url":self.url,"key_env":"YAG_POOL_KEY_1",
               "models":["managed-model"],"enabled":False,"priority":20}
        self.assertEqual(self.apply([entry])[0],200)
        for _ in range(3):
            code,_,body=request(self.port,"POST","/v1/chat/completions",
                         {"model":"managed-model","messages":[]})
            self.assertEqual(code,200,body)
            self.assertNotIn("managed-replica",body.decode())
        initial=self.store.read_bytes()
        for bad in (
            [{"url":"http://169.254.169.254/v1"}],
            [{"url":"http://8.8.8.8/v1"}],
            [{"url":"http://example.com/v1"}],
            [{"url":"http://127.0.0.1:1234/v1","key_env":"YAG_API_KEY"}],
            [{"url":self.url,"models":["bad model"]}],
            [{"url":self.url,"exclusive_models":True}],
            [{"url":self.url,"models":["managed-model"],"exclusive_models":"true"}],
            [{"url":self.url,"priority":101}],
            [{"url":self.url},{"url":self.url}],
            [{"url":"http://127.0.0.1:1/v1","raw_secret":"forbidden"}],
        ):
            with self.subTest(value=bad):
                self.assertEqual(self.apply(bad)[0],400)
                self.assertEqual(self.store.read_bytes(),initial)

    def test_035_https_cloud_api_base_paths_are_bounded(self):
        for url in ("https://openrouter.ai/api/v1",
                    "https://generativelanguage.googleapis.com/v1beta/openai"):
            with self.subTest(url=url):
                entry={"url":url,"key_env":"YAG_POOL_KEY_1",
                       "models":["cloud/model"],"enabled":False}
                code,_,body=self.apply([entry])
                self.assertEqual(code,200,body)
                self.assertEqual(json.loads(self.store.read_text())["replicas"][0]["url"],url)
        for url in ("http://192.168.1.50/api/v1",
                    "https://example.com/admin",
                    "https://openrouter.ai/api/v1/",
                    "https://openrouter.ai/api/v1?token=secret"):
            with self.subTest(url=url):
                self.assertEqual(self.apply([{"url":url}])[0],400)

    def test_04_busy_reconfig_returns_conflict_and_preserves_config(self):
        entry={"url":self.url,"key_env":"YAG_POOL_KEY_1",
               "models":["slow"],"enabled":True,"priority":0}
        self.assertEqual(self.apply([entry])[0],200)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            future=executor.submit(request,self.port,"POST","/v1/chat/completions",
                                   {"model":"slow","messages":[]})
            time.sleep(.15)
            code,_,body=self.apply([])
            self.assertEqual(code,409,body)
            self.assertEqual(future.result(timeout=5)[0],200)
        self.assertEqual(len(json.loads(self.store.read_text())["replicas"]),1)

    def test_045_exclusive_cloud_models_discovered_and_never_fallback(self):
        entry={"url":self.url,"key_env":"YAG_POOL_KEY_1",
               "models":["managed-model","glm-test"],"exclusive_models":True,"enabled":True}
        self.assertEqual(self.apply([entry])[0],200)
        code,_,body=request(self.port,"GET","/v1/models")
        self.assertEqual(code,200,body)
        listing=json.loads(body)["data"]
        self.assertEqual(sum(model["id"]=="managed-model" for model in listing),1)
        self.assertIn("managed-model",[m["id"] for m in listing])
        code,_,body=request(self.port,"GET","/v1/models/managed-model")
        self.assertEqual(code,200,body)
        self.assertEqual(json.loads(body)["owned_by"],"yag-managed-provider")
        # The primary also advertises glm-test; dedicated ownership wins.
        code,_,body=request(self.port,"GET","/v1/models/glm-test")
        self.assertEqual(code,200,body)
        self.assertEqual(json.loads(body)["owned_by"],"yag-managed-provider")
        code,_,body=request(self.port,"GET","/v1/models")
        self.assertEqual(code,200,body)
        self.assertEqual(sum(m["id"]=="glm-test" for m in json.loads(body)["data"]),1)
        for _ in range(5):
            code,_,body=request(self.port,"POST","/v1/chat/completions",
                                {"model":"managed-model","messages":[]})
            self.assertEqual(code,200,body)
            self.assertEqual(json.loads(body)["source"],"managed-replica")
        code,_,body=request(self.port,"GET","/api/admin/providers")
        self.assertEqual(code,200,body)
        self.assertTrue(json.loads(body)["data"][0]["exclusive_models"])
        self.assertTrue(json.loads(self.store.read_text())["replicas"][0]["exclusive_models"])
        # A disabled dedicated provider must fail closed, even when the
        # global fallback-to-primary flag is enabled.
        self.assertEqual(self.apply([{**entry,"enabled":False}])[0],200)
        code,_,body=request(self.port,"GET","/v1/models")
        self.assertEqual(code,200,body)
        self.assertNotIn("managed-model",[m["id"] for m in json.loads(body)["data"]])
        self.assertNotIn("glm-test",[m["id"] for m in json.loads(body)["data"]])
        code,_,body=request(self.port,"POST","/v1/chat/completions",
                            {"model":"managed-model","messages":[]})
        self.assertEqual(code,502,body)
        self.assertNotIn(b"managed-replica",body)

    def test_046_dedicated_models_require_explicit_per_pc_scope(self):
        entry={"url":self.url,"key_env":"YAG_POOL_KEY_1",
               "models":["managed-model"],"exclusive_models":True,"enabled":True}
        self.assertEqual(self.apply([entry])[0],200)
        # Ordinary LAN PC keys can discover models but not use a dedicated
        # remote provider. The guard applies to all protocol adapters.
        self.assertEqual(request(self.port,"GET","/v1/models",
                                 key=LOCAL_ONLY_KEY)[0],200)
        for path in ("/v1/chat/completions","/v1/completions",
                     "/v1/embeddings","/v1/responses","/v1/messages",
                     "/v1/images/generations","/v1/audio/speech"):
            with self.subTest(path=path):
                code,_,body=request(self.port,"POST",path,
                                    {"model":"managed-model","messages":[]},
                                    key=LOCAL_ONLY_KEY)
                self.assertEqual(code,403,body)
                self.assertIn(b"Dedicated model",body)
        # The same client may still use an ordinary primary/local model.
        code,_,body=request(self.port,"POST","/v1/chat/completions",
                            {"model":"glm-test","messages":[]},
                            key=LOCAL_ONLY_KEY)
        self.assertEqual(code,200,body)
        # A newly issued managed credential is granted only the explicitly
        # selected dedicated scope. No elevated access to admin is implied.
        code,_,body=request(self.port,"POST","/api/admin/clients",
            {"name":"Cloud-approved workstation",
             "scope":"inference+models+dedicated"})
        self.assertEqual(code,201,body)
        client_key=json.loads(body)["api_key"]
        code,_,body=request(self.port,"POST","/v1/chat/completions",
                            {"model":"managed-model","messages":[]},
                            key=client_key)
        self.assertEqual(code,200,body)
        self.assertEqual(json.loads(body)["source"],"managed-replica")
        self.assertEqual(request(self.port,"POST","/api/admin/providers/apply",
                                 {"replicas":[]},key=client_key)[0],403)
        # Managed scope survives restart, unlike in-memory request stats.
        cls=type(self)
        cls.proc.terminate();cls.proc.wait(timeout=10);cls.proc.stderr.close()
        cls.launch()
        code,_,body=request(self.port,"POST","/v1/chat/completions",
                            {"model":"managed-model","messages":[]},
                            key=client_key)
        self.assertEqual(code,200,body)
        self.assertEqual(request(self.port,"POST","/v1/chat/completions",
                   {"model":"managed-model","messages":[]},
                   key=LOCAL_ONLY_KEY)[0],403)
        code,_,body=request(self.port,"GET","/api/admin/clients")
        self.assertEqual(code,200,body)
        self.assertIn("inference+models+dedicated",
                      [item["scope"] for item in json.loads(body)["data"]])

    def test_047_cloud_models_survive_primary_discovery_outage(self):
        entry={"url":self.url,"key_env":"YAG_POOL_KEY_1",
               "models":["managed-model"],"exclusive_models":True,"enabled":True}
        self.assertEqual(self.apply([entry])[0],200)
        cls=type(self)
        old=cls.env["YAG_UPSTREAM_URL"]
        cls.proc.terminate();cls.proc.wait(timeout=10);cls.proc.stderr.close()
        try:
            cls.env["YAG_UPSTREAM_URL"]="http://127.0.0.1:1/v1"
            cls.launch()
            code,_,body=request(self.port,"GET","/v1/models")
            self.assertEqual(code,200,body)
            self.assertIn("managed-model",[m["id"] for m in json.loads(body)["data"]])
            code,_,body=request(self.port,"POST","/v1/chat/completions",
                                {"model":"managed-model","messages":[]})
            self.assertEqual(code,200,body)
            self.assertEqual(json.loads(body)["source"],"managed-replica")
        finally:
            if cls.proc.poll() is None:
                cls.proc.terminate();cls.proc.wait(timeout=10);cls.proc.stderr.close()
            cls.env["YAG_UPSTREAM_URL"]=old
            cls.launch()

    def test_05_restart_restores_managed_pool(self):
        entry={"url":self.url,"key_env":"YAG_POOL_KEY_1",
               "models":["managed-model"],"enabled":True,"priority":33}
        self.assertEqual(self.apply([entry])[0],200)
        cls=type(self)
        cls.proc.terminate();cls.proc.wait(timeout=10);cls.proc.stderr.close()
        cls.launch()
        code,_,body=request(self.port,"GET","/api/admin/providers")
        self.assertEqual(code,200,body)
        self.assertEqual(json.loads(body)["data"][0]["priority"],33)
        self.assertEqual(json.loads(body)["data"][0]["key_env"],"YAG_POOL_KEY_1")
        self.assertEqual(self.apply([])[0],200)


if __name__=="__main__":
    unittest.main(argv=[sys.argv[0]])
