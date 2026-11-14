#!/usr/bin/env python3
"""Resource-aware inference admission: slots, VRAM reservations and timeouts."""
import concurrent.futures
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

from integration import KEY, UPKEY, MockServer, request

class SlowBackend(BaseHTTPRequestHandler):
    protocol_version="HTTP/1.1"
    def log_message(self,*args): pass
    def send(self,code,data):
        payload=json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(payload)))
        self.end_headers()
        try:self.wfile.write(payload)
        except (BrokenPipeError,ConnectionResetError):pass
    def do_GET(self):
        if self.headers.get("Authorization")!="Bearer "+UPKEY:
            return self.send(401,{"error":"bad upstream key"})
        self.send(200,{"data":[{"id":"slow"}]})
    def do_POST(self):
        if self.headers.get("Authorization")!="Bearer "+UPKEY:
            return self.send(401,{"error":"bad upstream key"})
        payload=json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if payload.get("model")=="slow":time.sleep(.8)
        self.send(200,{"source":self.server.label,"request":payload})

class ResourcePool(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.binary=sys.argv[1]
        cls.primary=MockServer(("127.0.0.1",0),SlowBackend)
        cls.primary.label="primary"
        cls.replica=MockServer(("127.0.0.1",0),SlowBackend)
        cls.replica.label="replica"
        for server in (cls.primary,cls.replica):
            threading.Thread(target=server.serve_forever,daemon=True).start()
        cls.primary_url="http://127.0.0.1:"+str(cls.primary.server_port)+"/v1"
        cls.replica_url="http://127.0.0.1:"+str(cls.replica.server_port)+"/v1"

    @classmethod
    def tearDownClass(cls):
        for server in (cls.primary,cls.replica):
            server.shutdown();server.server_close()

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1",0))
            self.port=sock.getsockname()[1]
        self.proc=None

    def tearDown(self):
        self.stop()
        self.temp.cleanup()

    def stop(self):
        if self.proc:
            if self.proc.poll() is None:self.proc.terminate()
            self.proc.wait(timeout=10)
            self.proc.stderr.close()
            self.proc=None

    def launch(self,replica=None,**changes):
        self.stop()
        if replica is not None and "key_env" not in replica:
            replica={**replica,"key_env":"YAG_POOL_KEY_1"}
        config={
            "YAG_BIND":"127.0.0.1","YAG_PORT":str(self.port),
            "YAG_API_KEY":KEY,"YAG_UPSTREAM_KEY":UPKEY,
            "YAG_POOL_KEY_1":UPKEY,
            "YAG_UPSTREAM_URL":self.primary_url,
            "YAG_UPSTREAM_POOL":json.dumps([replica]) if replica else "[]",
            "YAG_PRIMARY_MAX_INFLIGHT":"1",
            "YAG_POOL_WAIT_MS":"0",
            "YAG_MAX_INFERENCE":"8",
            "YAG_MAX_INFERENCE_PER_KEY":"8",
            "NO_PROXY":"127.0.0.1,localhost",
            "YAG_PROVIDER_STORE":str(Path(self.temp.name)/"providers.json"),
        }
        config.update(changes)
        self.env=dict(os.environ,**config)
        self.proc=subprocess.Popen([self.binary],env=self.env,
            stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        for _ in range(100):
            if self.proc.poll() is not None:
                raise RuntimeError(self.proc.stderr.read().decode())
            try:
                if request(self.port,"GET","/health",key=None)[0]==200:return
            except OSError:time.sleep(.03)
        raise RuntimeError("YAG did not start")

    def post(self):
        return request(self.port,"POST","/v1/chat/completions",
                       {"model":"slow","messages":[]})

    def status(self):
        code,_,body=request(self.port,"GET","/api/providers/pool")
        self.assertEqual(code,200,body)
        return json.loads(body)

    def wait_for_active(self,count):
        for _ in range(75):
            data=self.status()
            if sum(x["active_requests"] for x in data["data"])==count:
                return data
            time.sleep(.02)
        self.fail("Expected active backend count "+str(count))

    def test_concurrency_and_reservations_are_released(self):
        self.launch({"url":self.replica_url,"max_inflight":1,
                     "vram_budget_mb":256,"vram_reservation_mb":256})
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            first=executor.submit(self.post)
            second=executor.submit(self.post)
            current=self.wait_for_active(2)
            self.assertEqual(current["data"][1]["vram_reserved_mb"],256)
            self.assertEqual(current["data"][1]["vram_budget_mb"],256)
            self.assertEqual(current["vram_source"],"operator_estimate")
            code,_,body=self.post()
            self.assertEqual(code,503,body)
            self.assertIn(b"resource_capacity",body)
            self.assertGreaterEqual(self.status()["resource_rejections"],1)
            for result in (first,second):
                self.assertEqual(result.result(timeout=5)[0],200)
        finished=self.status()
        self.assertEqual(finished["data"][1]["vram_reserved_mb"],0)
        self.assertEqual(sum(x["active_requests"] for x in finished["data"]),0)

    def test_vram_budget_without_slot_cap_also_blocks(self):
        self.launch({"url":self.replica_url,"max_inflight":0,
                     "vram_budget_mb":200,"vram_reservation_mb":150})
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            a=executor.submit(self.post);b=executor.submit(self.post)
            data=self.wait_for_active(2)
            self.assertEqual(data["data"][1]["max_inflight"],0)
            self.assertEqual(data["data"][1]["vram_reserved_mb"],150)
            self.assertEqual(self.post()[0],503)
            self.assertEqual(a.result(timeout=5)[0],200)
            self.assertEqual(b.result(timeout=5)[0],200)

    def test_dedicated_request_ceiling_fails_immediately_and_resets_on_restart(self):
        replica={"url":self.replica_url,"models":["slow"],
                 "exclusive_models":True,"max_requests_per_run":2}
        self.launch(replica,YAG_POOL_WAIT_MS="2500",
                    YAG_FALLBACK_TO_DEFAULT="1")
        self.assertEqual(self.post()[0],200)
        self.assertEqual(self.post()[0],200)
        pool=self.status()["data"][1]
        self.assertEqual(pool["requests_reserved"],2)
        self.assertEqual(pool["max_requests_per_run"],2)
        start=time.monotonic()
        code,_,body=self.post()
        elapsed=time.monotonic()-start
        self.assertEqual(code,503,body)
        self.assertIn(b"resource_capacity",body)
        # Quota exhaustion is not a transient slot/VRAM saturation.
        self.assertLess(elapsed,1.5)
        self.launch(replica,YAG_POOL_WAIT_MS="2500",
                    YAG_FALLBACK_TO_DEFAULT="1")
        self.assertEqual(self.status()["data"][1]["requests_reserved"],0)
        self.assertEqual(self.post()[0],200)

    def test_bounded_wait_wakes_after_release(self):
        self.launch({"url":self.replica_url,"models":["not-slow"]},
                    YAG_POOL_WAIT_MS="1600")
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            first=executor.submit(self.post)
            self.wait_for_active(1)
            second=executor.submit(self.post)
            waiting=False
            for _ in range(60):
                if self.status()["resource_waiting"]>0:
                    waiting=True;break
                time.sleep(.02)
            self.assertTrue(waiting)
            self.assertEqual(first.result(timeout=5)[0],200)
            self.assertEqual(second.result(timeout=5)[0],200)
            self.assertEqual(self.status()["resource_waiting"],0)

    def test_static_route_fallback_never_bypasses_primary_limit(self):
        routes=json.dumps([{"model":"unreachable",
                            "url":"http://127.0.0.1:1/v1"}])
        self.launch(YAG_FALLBACK_TO_DEFAULT="1",YAG_MODEL_ROUTES=routes)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            first=executor.submit(self.post)
            self.wait_for_active(1)
            code,_,body=request(self.port,"POST","/v1/chat/completions",
                     {"model":"unreachable","messages":[]})
            self.assertEqual(code,503,body)
            self.assertIn(b"resource_capacity",body)
            self.assertEqual(first.result(timeout=5)[0],200)
        code,_,body=request(self.port,"POST","/v1/chat/completions",
                 {"model":"unreachable","messages":[]})
        self.assertEqual(code,200,body)
        self.assertEqual(json.loads(body)["source"],"primary")

    def test_invalid_estimates_rejected_in_env_and_admin_store(self):
        base={"url":self.replica_url}
        invalid=[
            {"max_inflight":33},
            {"max_inflight":-1},
            {"vram_budget_mb":256},
            {"vram_reservation_mb":128},
            {"vram_budget_mb":100,"vram_reservation_mb":200},
            {"vram_budget_mb":262145,"vram_reservation_mb":1},
            {"max_requests_per_run":-1},
            {"max_requests_per_run":1000001},
            {"max_requests_per_run":True},
        ]
        for policy in invalid:
            with self.subTest(policy=policy):
                cfg=dict(os.environ,YAG_API_KEY=KEY,
                         YAG_UPSTREAM_POOL=json.dumps([{**base,**policy}]))
                proc=subprocess.run([self.binary],env=cfg,
                    capture_output=True,timeout=5)
                self.assertNotEqual(proc.returncode,0)
                self.assertIn(b"YAG_UPSTREAM_POOL",proc.stderr)
        self.launch()
        for policy in invalid:
            with self.subTest(admin=policy):
                payload={"replicas":[{**base,**policy}]}
                self.assertEqual(request(self.port,"POST",
                    "/api/admin/providers/apply",payload)[0],400)
        code,_,body=request(self.port,"GET","/api/admin/providers")
        self.assertEqual(code,200,body)
        self.assertEqual(json.loads(body)["data"],[])

    def test_managed_resource_policy_persists_after_restart(self):
        self.launch()
        policy={"url":self.replica_url,"max_inflight":1,
                "vram_budget_mb":256,"vram_reservation_mb":128,
                "models":["slow"],"priority":5}
        code,_,body=request(self.port,"POST","/api/admin/providers/apply",
                            {"replicas":[policy]})
        self.assertEqual(code,200,body)
        saved=Path(self.temp.name,"providers.json").read_text()
        self.assertIn('"max_inflight":1',saved)
        self.assertIn('"vram_budget_mb":256',saved)
        self.launch()
        code,_,body=request(self.port,"GET","/api/admin/providers")
        self.assertEqual(code,200,body)
        restored=json.loads(body)["data"][0]
        self.assertEqual(restored["vram_budget_mb"],256)
        self.assertEqual(restored["vram_reservation_mb"],128)
        self.assertEqual(restored["max_inflight"],1)

if __name__=="__main__":
    unittest.main(argv=[sys.argv[0]])
