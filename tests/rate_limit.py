#!/usr/bin/env python3
"""Isolated per-key rate limiting test against a deterministic mock backend."""
import os
import socket
import subprocess
import sys
import threading
import time
import unittest

from integration import Backend, KEY, MockServer, UPKEY, request

SECOND_KEY = 'additional-key-for-testing'

class RateLimitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend = MockServer(('127.0.0.1', 0), Backend)
        threading.Thread(target=cls.backend.serve_forever, daemon=True).start()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            cls.port = sock.getsockname()[1]
        env = dict(os.environ,
            YAG_BIND='127.0.0.1', YAG_PORT=str(cls.port),
            YAG_API_KEY=KEY, YAG_EXTRA_API_KEYS=SECOND_KEY,
            YAG_RATE_LIMIT_PER_MINUTE='2',
            YAG_UPSTREAM_KEY=UPKEY,
            YAG_UPSTREAM_URL=f'http://127.0.0.1:{cls.backend.server_port}/v1',
            NO_PROXY='127.0.0.1,localhost')
        cls.proc = subprocess.Popen([sys.argv[1]], env=env,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        for _ in range(100):
            if cls.proc.poll() is not None:
                raise RuntimeError(cls.proc.stderr.read().decode())
            try:
                if request(cls.port, 'GET', '/health', key=None)[0] == 200:
                    break
            except OSError:
                time.sleep(.03)
        else:
            raise RuntimeError('Rate limited Host did not start')

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(timeout=5)
        cls.proc.stderr.close()
        cls.backend.shutdown()
        cls.backend.server_close()

    def test_each_key_has_independent_budget(self):
        path = '/v1/models'
        first = [request(self.port, 'GET', path) for _ in range(3)]
        second = [request(self.port, 'GET', path, key=SECOND_KEY)
                  for _ in range(3)]
        self.assertEqual([status for status, _, _ in first], [200, 200, 429])
        self.assertEqual([status for status, _, _ in second], [200, 200, 429])
        for status, headers, body in (first[-1], second[-1]):
            self.assertEqual(status, 429)
            self.assertEqual(headers.get('Cache-Control'), 'no-store')
            retry = int(headers['Retry-After'])
            self.assertGreaterEqual(retry, 1)
            self.assertLessEqual(retry, 60)
            self.assertIn(b'Rate limit exceeded', body)
        self.assertNotIn('Retry-After', first[0][1])
        self.assertEqual(request(self.port, 'GET', path, key=None)[0], 401)
        self.assertEqual(request(self.port, 'GET', '/health', key=None)[0], 200)

if __name__ == '__main__':
    unittest.main(argv=[sys.argv[0]])
