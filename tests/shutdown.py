#!/usr/bin/env python3
"""Ensure SIGTERM drains active proxy requests before releasing global curl."""
import json
import os
import socket
import subprocess
import sys
import threading
import time
import unittest

from integration import Backend, KEY, UPKEY, MockServer, request

class GracefulShutdown(unittest.TestCase):
    def test_sigterm_waits_for_active_transfer(self):
        backend=MockServer(('127.0.0.1',0),Backend)
        threading.Thread(target=backend.serve_forever,daemon=True).start()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0))
            port=sock.getsockname()[1]
        env=dict(os.environ,YAG_BIND='127.0.0.1',YAG_PORT=str(port),
                 YAG_API_KEY=KEY,YAG_UPSTREAM_KEY=UPKEY,
                 YAG_UPSTREAM_URL=f'http://127.0.0.1:{backend.server_port}/v1',
                 YAG_TIMEOUT='5',NO_PROXY='127.0.0.1,localhost')
        proc=subprocess.Popen([sys.argv[1]],env=env,stdout=subprocess.DEVNULL,
                              stderr=subprocess.PIPE)
        result=[]
        errors=[]
        try:
            for _ in range(100):
                if proc.poll() is not None:
                    raise RuntimeError(proc.stderr.read().decode())
                try:
                    if request(port,'GET','/health',key=None)[0]==200:break
                except OSError:time.sleep(.03)
            else:raise RuntimeError('Gateway did not start')

            def send_slow():
                try:
                    result.append(request(port,'POST','/v1/chat/completions',
                        {'model':'slow','messages':[{'role':'user','content':'hello'}]}))
                except Exception as exc:
                    errors.append(type(exc).__name__)

            worker=threading.Thread(target=send_slow)
            worker.start()
            active=False
            for _ in range(30):
                status=json.loads(request(port,'GET','/api/status')[2])
                if status['active_connections']>=2:
                    active=True
                    break
                time.sleep(.02)
            self.assertTrue(active,'Slow upstream request not active before SIGTERM')
            proc.terminate()
            time.sleep(.1)
            self.assertIsNone(proc.poll(),'Host exited while an active transfer was running')
            worker.join(timeout=4)
            self.assertFalse(worker.is_alive(),'In-flight Chat transfer did not drain')
            self.assertFalse(errors,errors)
            self.assertEqual(result[0][0],200)
            self.assertEqual(proc.wait(timeout=4),0,'SIGTERM should be graceful')
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=5)
            proc.stderr.close()
            backend.shutdown()
            backend.server_close()

if __name__=='__main__':
    unittest.main(argv=[sys.argv[0]])
