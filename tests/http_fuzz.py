#!/usr/bin/env python3
"""Bounded, deterministic HTTP parser robustness and slow-client regression."""
import os
import random
import socket
import subprocess
import sys
import time
import unittest

from integration import KEY, request

class HttpRobustness(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0))
            cls.port=sock.getsockname()[1]
        env=dict(os.environ,YAG_API_KEY=KEY,YAG_BIND='127.0.0.1',
            YAG_PORT=str(cls.port),YAG_HEADER_DEADLINE_SECONDS='1',
            YAG_BODY_DEADLINE_SECONDS='1',NO_PROXY='127.0.0.1,localhost')
        cls.process=subprocess.Popen([sys.argv[1]],env=env,
                                     stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        for _ in range(100):
            if cls.process.poll() is not None:
                raise RuntimeError(cls.process.stderr.read().decode())
            try:
                if request(cls.port,'GET','/health',key=None)[0]==200:break
            except OSError:time.sleep(.03)
        else:raise RuntimeError('Gateway did not start')

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=5)
        cls.process.stderr.close()

    def raw(self,bytestring,timeout=3):
        with socket.create_connection(('127.0.0.1',self.port),timeout=timeout) as s:
            s.settimeout(timeout)
            s.sendall(bytestring)
            return s.recv(2048)

    def test_absolute_header_timeout(self):
        self.assertIn(b'408',self.raw(b'GET /health HTTP/1.1\r\nHost: x\r\n',timeout=3))
        self.assertEqual(request(self.port,'GET','/health',key=None)[0],200)

    def test_absolute_body_timeout(self):
        partial=b'POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\n' \
            +b'Authorization: Bearer '+KEY.encode() \
            +b'\r\nContent-Length: 200\r\n\r\n{'
        self.assertIn(b'408',self.raw(partial,timeout=3))
        self.assertEqual(request(self.port,'GET','/health',key=None)[0],200)

    def test_invalid_framing_regressions(self):
        bad=[
            b'GET /health HTTP/1.2\r\n\r\n',
            b'GET /health HTTP/1.1\r\nHost: x\r\nBad Name: fail\r\n\r\n',
            b'POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\nContent-Length: 12\r\nContent-Length: 12\r\n\r\n',
            b'POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nContent-Length: 0\r\n\r\n',
            b'POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\nContent-Length: -1\r\n\r\n',
            b'POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\nContent-Length: 9999999\r\n\r\n',
            b'GET /health HTTP/1.1\r\nX-Byte: bad\x00value\r\n\r\n',
        ]
        for message in bad:
            response=self.raw(message)
            self.assertTrue(response.startswith(b'HTTP/1.1 4'),response)

    def test_known_framing_errors_have_precise_http_status(self):
        auth=b'Authorization: Bearer '+KEY.encode()+b'\r\n'
        cases=[
            (b'Content-Length: 0\r\nContent-Length: 0\r\n',400),
            (b'Transfer-Encoding: chunked\r\n',400),
            (b'Content-Length: -1\r\n',400),
            (b'Content-Length: 9999999999999999999\r\n',413),
            (b'Content-Length: 1 2\r\n',400),
            (b'Content-Length : 0\r\n',400),
            (b'Expect: unsupported\r\nContent-Length: 0\r\n',417),
        ]
        for fields,expected in cases:
            with self.subTest(fields=fields):
                payload=(b'POST /v1/chat/completions HTTP/1.1\r\n'
                    b'Host: localhost\r\n'+auth+fields+b'\r\n')
                reply=self.raw(payload)
                self.assertTrue(reply.startswith(
                    b'HTTP/1.1 '+str(expected).encode()+b' '),reply)
        self.assertEqual(request(self.port,'GET','/health',key=None)[0],200)

    def test_security_parser_matrix(self):
        """HTTP parser regression matrix: explicit byte-level cases."""
        auth = b'Authorization: Bearer '+KEY.encode()+b'\r\n'
        get = b'GET /health HTTP/1.1\r\nHost: local\r\n'
        post = b'POST /v1/chat/completions HTTP/1.1\r\nHost: local\r\n'+auth
        cases = [
            # HTTP_SECURITY_CASES_START
            ('request-line-01',b' GET /health HTTP/1.1\r\nHost: local\r\n\r\n',400),
            ('request-line-02',b'GET  /health HTTP/1.1\r\nHost: local\r\n\r\n',400),
            ('request-line-03',b'GET /health  HTTP/1.1\r\nHost: local\r\n\r\n',400),
            ('request-line-04',b'GET /health HTTP/1.1 \r\nHost: local\r\n\r\n',400),
            ('request-line-05',b'GET\t/health HTTP/1.1\r\nHost: local\r\n\r\n',400),
            ('request-line-06',b'GET /health\tHTTP/1.1\r\nHost: local\r\n\r\n',400),
            ('request-line-07',b'GET /health HTTP/1.1\t\r\nHost: local\r\n\r\n',400),
            ('request-line-08',b'GET\t /health HTTP/1.1\r\nHost: local\r\n\r\n',400),
            ('request-line-09',b'GET \t/health HTTP/1.1\r\nHost: local\r\n\r\n',400),
            ('request-line-10',b'GET /health \tHTTP/1.1\r\nHost: local\r\n\r\n',400),
            ('request-line-11',b'GET /health HTTP/1.1\x7f\r\nHost: local\r\n\r\n',400),
            ('request-line-12',b'GET http://example.test/ HTTP/1.1\r\nHost: local\r\n\r\n',400),
            ('request-line-13',b'GET https://example.test/ HTTP/1.1\r\nHost: local\r\n\r\n',400),
            ('request-line-14',b'GET health HTTP/1.1\r\nHost: local\r\n\r\n',400),
            ('request-line-15',b'GET * HTTP/1.1\r\nHost: local\r\n\r\n',400),
            ('request-line-16',b'GET ?key=1 HTTP/1.1\r\nHost: local\r\n\r\n',400),
            ('request-line-17',b'GET \\health HTTP/1.1\r\nHost: local\r\n\r\n',400),
            ('request-line-18',b'GET ../health HTTP/1.1\r\nHost: local\r\n\r\n',400),
            ('request-line-19',b'GET /health HTTP/1.2\r\nHost: local\r\n\r\n',400),
            # HTTP_SECURITY_CASES_END
        ]
        for label,payload,expected in cases:
            with self.subTest(case=label):
                response=self.raw(payload)
                self.assertTrue(response.startswith(
                    b'HTTP/1.1 '+str(expected).encode()+b' '),
                    (label,response))
        self.assertEqual(request(self.port,'GET','/health',key=None)[0],200)

    def test_deterministic_malformed_header_corpus(self):
        rng=random.Random(190283)
        for _ in range(120):
            raw=bytes(rng.randrange(1,256) for _ in range(rng.randrange(4,96)))
            # Always finish the header to avoid accidental intentional timeouts.
            payload=b'GET /health HTTP/1.1\r\nHost: x\r\nX-Fuzz'+raw+b': a\r\n\r\n'
            response=self.raw(payload)
            self.assertTrue(response.startswith(b'HTTP/1.1 '),response)
        self.assertEqual(request(self.port,'GET','/health',key=None)[0],200)

if __name__=='__main__':
    unittest.main(argv=[sys.argv[0]])
