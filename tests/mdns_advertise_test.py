#!/usr/bin/env python3
"""Regression tests for the optional YAG mDNS advertiser (no zeroconf needed)."""
import importlib.util
import pathlib
import unittest


PATH = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "mdns_advertise.py"
SPEC = importlib.util.spec_from_file_location("yag_mdns", PATH)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class AdvertiserValidationTests(unittest.TestCase):
    def test_accepts_private_ipv4_and_lan_label(self):
        ip, label = module.validate("192.168.1.50", "Colibri", 443)
        self.assertEqual(str(ip), "192.168.1.50")
        self.assertEqual(label, "Colibri")

    def test_rejects_public_host(self):
        for address in ("8.8.8.8", "224.0.0.1", "0.0.0.0", "127.0.0.1"):
            with self.subTest(address=address):
                with self.assertRaises(ValueError):
                    module.validate(address, "Colibri", 443)

    def test_rejects_malformed_metadata(self):
        for name in ("", "name.\nexample", "🚩", "a" * 61):
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    module.validate("10.10.0.5", name, 443)
        for port in (0, -2, 65536):
            with self.subTest(port=port):
                with self.assertRaises(ValueError):
                    module.validate("10.10.0.5", "Colibri", port)


if __name__ == "__main__":
    unittest.main()
