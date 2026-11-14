#!/usr/bin/env python3
"""Opt-in YAG Host LAN advertisement.

Advertises only the HTTPS gateway *address*, never model inventory, client
identities or credentials. Requires: python -m pip install zeroconf
This script is intentionally run on the Host, not inside the YAG container.
"""
import argparse
import ipaddress
import signal
import sys
import threading


def validate(ip_raw, name_raw, port):
    ip = ipaddress.IPv4Address(ip_raw)
    if not (ip.is_private or ip.is_link_local) or ip.is_multicast or ip.is_unspecified:
        raise ValueError("Advertise only a private IPv4 address belonging to the Host")
    if not (1 <= port <= 65535):
        raise ValueError("Port must be between 1 and 65535")
    name = name_raw.strip()
    if not (1 <= len(name) <= 60) or any(c not in
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_" for c in name):
        raise ValueError("Host name must be 1-60 safe ASCII characters")
    return ip, name


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lan-ip", required=True, help="Host private LAN IPv4 bound by Caddy")
    parser.add_argument("--name", default="YAG Colibri", help="Public LAN discovery label")
    parser.add_argument("--port", type=int, default=443, help="HTTPS Caddy port")
    args = parser.parse_args(argv)
    try:
        ip, name = validate(args.lan_ip, args.name, args.port)
    except (ValueError, ipaddress.AddressValueError) as exc:
        parser.error(str(exc))
    try:
        from zeroconf import ServiceInfo, Zeroconf
    except ImportError:
        print("Install optional dependency: python -m pip install zeroconf", file=sys.stderr)
        return 2

    info = ServiceInfo(
        type_="_yag._tcp.local.",
        name=f"{name}._yag._tcp.local.",
        addresses=[ip.packed],
        port=args.port,
        properties={"tls": "1", "version": "1"},
        server=f"{name.replace(' ', '-')}.local.",
    )
    stop = threading.Event()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda _signum, _frame: stop.set())
    zc = Zeroconf(interfaces=[str(ip)])
    try:
        zc.register_service(info)
        print(f"Advertising YAG Host https://{ip}:{args.port} on local multicast DNS")
        print("TLS trust and an individual client API key are still required.")
        stop.wait()
    finally:
        zc.unregister_service(info)
        zc.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
