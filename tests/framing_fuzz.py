#!/usr/bin/env python3
"""Deterministic malformed HTTP field-name fuzz regression.

This is not coverage-guided fuzzing or a security audit. It asserts that the
listener rejects invalid header token bytes without crashing or leaking data.
"""
import random
import socket
import sys
import unittest
from integration import Integration, KEY, request

class FramingFuzz(unittest.TestCase):
    setUpClass=classmethod(Integration.setUpClass.__func__)
    tearDownClass=classmethod(Integration.tearDownClass.__func__)

    def test_invalid_token_bytes_are_rejected(self):
        rnd=random.Random(5200)
        invalid=list(range(0,33))+[58,127,128,255]
        for _ in range(72):
            first=bytes(rnd.choice(b'ABCDEFGHIJKLMNOPQRSTUVWXYZ') for _ in range(5))
            bad=bytes([rnd.choice(invalid)])
            name=first+bad+b'Header'
            payload=(b'GET /health HTTP/1.1\r\nHost: localhost\r\n'
                     +name+b': ignored\r\n\r\n')
            with socket.create_connection(('127.0.0.1',self.port),timeout=2) as s:
                s.sendall(payload)
                response=s.recv(2048)
                self.assertIn(b'400',response,name)
        self.assertEqual(request(self.port,'GET','/health',key=None)[0],200)

    def test_conflicting_framing_and_expectation(self):
        auth=b'Authorization: Bearer '+KEY.encode()+b'\r\n'
        cases=[
            (b'Content-Length: 0\r\nContent-Length: 0\r\n',400),
            (b'Transfer-Encoding: chunked\r\n',400),
            (b'Content-Length: -1\r\n',400),
            (b'Content-Length: 9999999999999999999\r\n',413),
            (b'Content-Length: 1 2\r\n',400),
            (b'Content-Length : 0\r\n',400),
            (b'Expect: something-else\r\nContent-Length: 0\r\n',417)
        ]
        for fields,status in cases:
            data=b'POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\n'+auth+fields+b'\r\n'
            with socket.create_connection(('127.0.0.1',self.port),timeout=2) as s:
                s.sendall(data)
                got=s.recv(2048)
                self.assertIn(str(status).encode(),got,fields)
        self.assertEqual(request(self.port,'GET','/health',key=None)[0],200)

if __name__=='__main__':
    unittest.main(argv=[sys.argv[0]])
