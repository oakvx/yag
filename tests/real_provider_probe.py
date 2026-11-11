#!/usr/bin/env python3
"""Opt-in real-model gateway probe, with a temporary isolated local YAG host.

No mocked inference: a real OpenAI-compatible upstream must be running and
YAG_REAL_UPSTREAM_URL and YAG_REAL_MODEL must be provided. Calls may cost money.
No model output, prompt, credentials or provider URLs are written to logs.
"""
import argparse
import os
import secrets
import socket
import subprocess
import sys
import time
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, build_opener

from live_model import exercise

PROTOCOLS = {
    'chat': 'chat/completions',
    'responses': 'responses',
    'anthropic': 'messages',
}

def validate_upstream_url(raw):
    """Avoid ambiguous hosts, embedded secrets and accidental plaintext remote use."""
    if not raw or any(ch.isspace() for ch in raw):
        raise ValueError('Upstream URL is missing or contains whitespace')
    try:
        url = urlsplit(raw)
        port = url.port  # raises ValueError for malformed ports
    except ValueError as exc:
        raise ValueError('Malformed upstream URL') from None
    if (url.scheme not in ('http','https') or not url.hostname
        or url.username is not None or url.password is not None
        or url.query or url.fragment or url.path != '/v1'
        or (port is not None and port == 0)):
        raise ValueError('Upstream URL must be a clean HTTP(S) origin ending in /v1')
    if url.scheme == 'http' and url.hostname not in ('localhost','127.0.0.1','::1'):
        raise ValueError('Remote inference backends must use HTTPS')
    return raw

def local_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0))
        return sock.getsockname()[1]

def qualify(host,upstream,model,upstream_key,protocol='all',tools=False,stream=False):
    validate_upstream_url(upstream)
    if not model or len(model)>256 or any(ch.isspace() for ch in model):
        raise ValueError('A valid upstream model identifier is required')
    if not os.path.isfile(host):
        raise ValueError('The YAG binary does not exist')
    port=local_port()
    gateway_key=secrets.token_hex(24)
    env=dict(os.environ)
    env.update(
        YAG_BIND='127.0.0.1',YAG_PORT=str(port),YAG_API_KEY=gateway_key,
        YAG_UPSTREAM_URL=upstream,YAG_UPSTREAM_KEY=upstream_key,
        YAG_MODEL_ROUTES='',YAG_MODEL_CAPABILITIES='',
        YAG_EXTRA_API_KEYS='',YAG_EXTRA_KEY_SCOPES='',
        YAG_FALLBACK_TO_DEFAULT='0',YAG_CIRCUIT_THRESHOLD='0',
        YAG_ENFORCE_MODEL_CAPABILITIES='0',YAG_RATE_LIMIT_PER_MINUTE='0',
        YAG_TIMEOUT='90',NO_PROXY='localhost,127.0.0.1,::1',
        no_proxy='localhost,127.0.0.1,::1')
    child=subprocess.Popen([os.path.abspath(host)],env=env,
        stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    base=f'http://127.0.0.1:{port}'
    opener=build_opener(ProxyHandler({}))
    try:
        deadline=time.monotonic()+8
        while time.monotonic()<deadline:
            if child.poll() is not None:
                raise RuntimeError('Gateway exited before readiness')
            try:
                with opener.open(base+'/health',timeout=0.5) as response:
                    if response.status==200:break
            except OSError:
                time.sleep(0.05)
        else:
            raise RuntimeError('Gateway did not start on localhost')
        names=list(PROTOCOLS.values()) if protocol=='all' else [PROTOCOLS[protocol]]
        failed=0
        for name in names:
            try:
                exercise(base,gateway_key,model,name,tools,False)
                if stream:
                    exercise(base,gateway_key,model,name,False,True)
            except (ValueError,KeyError,TypeError,AssertionError,RuntimeError) as exc:
                print('[FAIL]',name,type(exc).__name__,file=sys.stderr,flush=True)
                failed+=1
        if failed:
            print('Real-model qualification failed for',failed,'protocol(s)',file=sys.stderr)
        else:
            print('Real-model qualification passed for selected checks')
        return 1 if failed else 0
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host',required=True,help='Path to an existing YAG executable')
    parser.add_argument('--protocol',choices=['all','chat','responses','anthropic'],
                        default='all')
    parser.add_argument('--tools',action='store_true',
                        help='Require real model function-tool and result-replay cycles')
    parser.add_argument('--stream',action='store_true',
                        help='Also verify terminal SSE events')
    args=parser.parse_args()
    upstream=os.environ.get('YAG_REAL_UPSTREAM_URL','')
    model=os.environ.get('YAG_REAL_MODEL','')
    if not upstream or not model:
        parser.error('Set YAG_REAL_UPSTREAM_URL and YAG_REAL_MODEL explicitly')
    try:
        return qualify(args.host,upstream,model,
            os.environ.get('YAG_REAL_UPSTREAM_KEY',''),args.protocol,
            args.tools,args.stream)
    except (ValueError,RuntimeError) as exc:
        # All error strings above are static and do not include secrets or URLs.
        print('[FAIL]',type(exc).__name__,str(exc),file=sys.stderr)
        return 1

if __name__=='__main__':
    sys.exit(main())
