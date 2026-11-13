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
            ('request-line-20',b'GET /health HTTP/2.0\r\nHost: local\r\n\r\n',400),
            ('header-control-00',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x00b\r\n\r\n',400),
            ('header-control-01',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x01b\r\n\r\n',400),
            ('header-control-02',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x02b\r\n\r\n',400),
            ('header-control-03',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x03b\r\n\r\n',400),
            ('header-control-04',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x04b\r\n\r\n',400),
            ('header-control-05',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x05b\r\n\r\n',400),
            ('header-control-06',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x06b\r\n\r\n',400),
            ('header-control-07',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x07b\r\n\r\n',400),
            ('header-control-08',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x08b\r\n\r\n',400),
            ('header-control-0a',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x0ab\r\n\r\n',400),
            ('header-control-0b',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x0bb\r\n\r\n',400),
            ('header-control-0c',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x0cb\r\n\r\n',400),
            ('header-control-0d',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x0db\r\n\r\n',400),
            ('header-control-0e',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x0eb\r\n\r\n',400),
            ('header-control-0f',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x0fb\r\n\r\n',400),
            ('header-control-10',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x10b\r\n\r\n',400),
            ('header-control-11',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x11b\r\n\r\n',400),
            ('header-control-12',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x12b\r\n\r\n',400),
            ('header-control-13',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x13b\r\n\r\n',400),
            ('header-control-14',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x14b\r\n\r\n',400),
            ('header-control-15',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x15b\r\n\r\n',400),
            ('header-control-16',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x16b\r\n\r\n',400),
            ('header-control-17',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x17b\r\n\r\n',400),
            ('header-control-1f',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x1fb\r\n\r\n',400),
            ('header-control-7f',b'GET /health HTTP/1.1\r\nHost: local\r\nX-Control: a\x7fb\r\n\r\n',400),
            ('header-name-09',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x09Check: a\r\n\r\n',400),
            ('header-name-20',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x20Check: a\r\n\r\n',400),
            ('header-name-22',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x22Check: a\r\n\r\n',400),
            ('header-name-28',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x28Check: a\r\n\r\n',400),
            ('header-name-29',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x29Check: a\r\n\r\n',400),
            ('header-name-2c',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x2cCheck: a\r\n\r\n',400),
            ('header-name-2f',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x2fCheck: a\r\n\r\n',400),
            ('header-name-3b',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x3bCheck: a\r\n\r\n',400),
            ('header-name-3c',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x3cCheck: a\r\n\r\n',400),
            ('header-name-3d',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x3dCheck: a\r\n\r\n',400),
            ('header-name-3e',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x3eCheck: a\r\n\r\n',400),
            ('header-name-3f',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x3fCheck: a\r\n\r\n',400),
            ('header-name-40',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x40Check: a\r\n\r\n',400),
            ('header-name-5b',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x5bCheck: a\r\n\r\n',400),
            ('header-name-5c',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x5cCheck: a\r\n\r\n',400),
            ('header-name-5d',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x5dCheck: a\r\n\r\n',400),
            ('header-name-7b',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x7bCheck: a\r\n\r\n',400),
            ('header-name-7d',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x7dCheck: a\r\n\r\n',400),
            ('header-name-7f',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x7fCheck: a\r\n\r\n',400),
            ('header-name-80',b'GET /health HTTP/1.1\r\nHost: local\r\nX\x80Check: a\r\n\r\n',400),
            ('invalid-length-01',post+b'Content-Length: \r\n\r\n',400),
            ('invalid-length-02',post+b'Content-Length: -1\r\n\r\n',400),
            ('invalid-length-03',post+b'Content-Length: +1\r\n\r\n',400),
            ('invalid-length-04',post+b'Content-Length: 1 2\r\n\r\n',400),
            ('invalid-length-05',post+b'Content-Length: 1,2\r\n\r\n',400),
            ('invalid-length-06',post+b'Content-Length: 1.0\r\n\r\n',400),
            ('invalid-length-07',post+b'Content-Length: 0x0\r\n\r\n',400),
            ('invalid-length-08',post+b'Content-Length: 1e2\r\n\r\n',400),
            ('invalid-length-09',post+b'Content-Length: NaN\r\n\r\n',400),
            ('invalid-length-10',post+b'Content-Length: Infinity\r\n\r\n',400),
            ('invalid-length-11',post+b'Content-Length: null\r\n\r\n',400),
            ('invalid-length-12',post+b'Content-Length: none\r\n\r\n',400),
            ('invalid-length-13',post+b'Content-Length: 12x\r\n\r\n',400),
            ('invalid-length-14',post+b'Content-Length: 0/1\r\n\r\n',400),
            ('invalid-length-15',post+b'Content-Length: 1;2\r\n\r\n',400),
            ('security-edge-duplicate-host',get+b'Host: second\r\n\r\n',400),
            ('security-edge-case-insensitive-duplicate-host',get+b'hOsT: second\r\n\r\n',400),
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
