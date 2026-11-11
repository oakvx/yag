#!/usr/bin/env python3
"""Pure unit tests: real-provider probe URL and input policy (no network)."""
import unittest

from real_provider_probe import validate_upstream_url, qualify

class RealProviderProbeConfiguration(unittest.TestCase):
    def test_loopback_http_and_remote_https(self):
        self.assertEqual(validate_upstream_url('http://127.0.0.1:8000/v1'),
                         'http://127.0.0.1:8000/v1')
        self.assertEqual(validate_upstream_url('http://[::1]:8000/v1'),
                         'http://[::1]:8000/v1')
        self.assertEqual(validate_upstream_url('https://models.example.com/v1'),
                         'https://models.example.com/v1')

    def test_reject_remote_plaintext_and_credentials(self):
        invalid=[
            '', 'http://models.example.com/v1',
            'http://127.0.0.1.evil.example/v1',
            'https://user:password@models.example.com/v1',
            'https://models.example.com/v1?token=secret',
            'https://models.example.com/v1#fragment',
            'https://models.example.com/v1/',
            'file:///tmp/model',
            'http://[::1]:abc/v1',
            'http://[::1/v1',
            ' http://127.0.0.1:8000/v1',
            'http://127.0.0.1:0/v1',
        ]
        for value in invalid:
            with self.subTest(value=value),self.assertRaises(ValueError):
                validate_upstream_url(value)

    def test_invalid_model_or_binary_rejected_without_network(self):
        with self.assertRaises(ValueError):
            qualify('/nonexistent/yag','http://127.0.0.1:8000/v1','', '')
        with self.assertRaises(ValueError):
            qualify('/nonexistent/yag','http://127.0.0.1:8000/v1','model name','')
        with self.assertRaises(ValueError):
            qualify('/nonexistent/yag','http://127.0.0.1:8000/v1','valid-model','')

if __name__=='__main__':
    unittest.main()
