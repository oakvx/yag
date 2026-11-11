#!/usr/bin/env python3
"""A bounded concurrent localhost smoke test, NOT a throughput benchmark."""
import concurrent.futures
import json
import os
import socket
import subprocess
import sys
import time
import unittest

from integration import KEY,request

class ConcurrentSmoke(unittest.TestCase):
    def test_parallel_readiness_and_authenticated_status(self):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0))
            port=sock.getsockname()[1]
        env=dict(os.environ,YAG_API_KEY=KEY,YAG_BIND='127.0.0.1',
                 YAG_PORT=str(port),NO_PROXY='127.0.0.1,localhost')
        proc=subprocess.Popen([sys.argv[1]],env=env,
                              stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        try:
            for _ in range(100):
                if proc.poll() is not None:raise RuntimeError(proc.stderr.read().decode())
                try:
                    if request(port,'GET','/health',key=None)[0]==200:break
                except OSError:time.sleep(.03)
            else:raise RuntimeError('Host failed to start')
            def check(index):
                if index%3==0:
                    status,_,body=request(port,'GET','/health',key=None)
                    return status==200 and json.loads(body)['status']=='ok'
                status,_,body=request(port,'GET','/api/status')
                return status==200 and json.loads(body)['status']=='ok'
            with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
                successes=list(pool.map(check,range(120)))
            self.assertEqual(sum(successes),120,
                             'Gateway failed to serve a bounded parallel smoke workload')
            total=json.loads(request(port,'GET','/api/status')[2])['total_connections']
            self.assertGreaterEqual(total,122)
        finally:
            proc.terminate()
            proc.wait(timeout=6)
            proc.stderr.close()

if __name__=='__main__':
    unittest.main(argv=[sys.argv[0]])
