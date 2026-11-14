#!/usr/bin/env python3
"""Opt-in real-model gateway probe, with a temporary isolated local YAG host.

No mocked inference: a real OpenAI-compatible upstream must be running and
YAG_REAL_UPSTREAM_URL and YAG_REAL_MODEL must be provided. Calls may cost money.
No model output, prompt, credentials or provider URLs are written to logs.
"""
import argparse
import datetime
import hashlib
import platform
import json
import os
import re
import stat
import secrets
import socket
import subprocess
import sys
import time
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, build_opener

from live_model import exercise

def _runtime_metadata():
    """Public, non-unique runtime characteristics: never hostnames or serials."""
    result = {
        'os': platform.system().lower(),
        'architecture': platform.machine().lower(),
        'gpu': None,
        'ollama_cli_version': None,
    }
    def capture(argv, limit=140):
        try:
            completed = subprocess.run(argv, capture_output=True, text=True,
                                       timeout=3, check=False)
        except (OSError, subprocess.TimeoutExpired):
            return None
        value = completed.stdout.strip().splitlines()
        if completed.returncode or not value:
            return None
        first = value[0][:limit]
        return first if re.fullmatch(r'[A-Za-z0-9 .,:;_+()/-]+', first) else None
    result['ollama_cli_version'] = capture(['ollama', '--version'])
    line = capture(['nvidia-smi','--query-gpu=name,driver_version,memory.total',
                    '--format=csv,noheader,nounits'])
    if line:
        parts = [part.strip() for part in line.split(',')]
        if len(parts) == 3 and re.fullmatch(r'[0-9]+(?:\.[0-9]+)*', parts[1]) and parts[2].isdigit():
            result['gpu'] = {
                'name': parts[0],
                'driver_version': parts[1],
                'memory_total_mib': int(parts[2]),
                'source': 'nvidia-smi'
            }
    return result

def write_report(path,model,selected,tools,stream,results,success):
    """Write metadata-only evidence, never secrets, URLs, prompts or model text.

    A SHA-256 of the model ID supports private comparison without disclosing
    the operator's model identifier in public Actions artifacts.
    """
    sha=os.environ.get('GITHUB_SHA','')
    report={
        'schema_version':2,
        'source':'real_upstream_gateway_probe',
        'measured_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'runtime':_runtime_metadata(),
        'model_id_sha256':hashlib.sha256(model.encode('utf-8')).hexdigest(),
        'gateway_commit':sha if re.fullmatch(r'[a-fA-F0-9]{40}',sha) else None,
        'protocol_selection':selected,
        'stream_requested':bool(stream),
        'tool_replay_requested':bool(tools),
        'results':results,
        'qualified':bool(success),
        'scope':'exact_model_runtime_configuration',
    }
    flags=os.O_WRONLY|os.O_CREAT|os.O_TRUNC
    if hasattr(os,'O_NOFOLLOW'):flags|=os.O_NOFOLLOW
    fd=os.open(path,flags,0o600)
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1:
            raise ValueError('Report destination must be a regular single-link file')
        os.fchmod(fd,0o600)
        with os.fdopen(fd,'w',encoding='utf-8') as output:
            fd=-1
            json.dump(report,output,sort_keys=True,separators=(',',':'))
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
    finally:
        if fd>=0:os.close(fd)


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

def qualify(host,upstream,model,upstream_key,protocol='all',tools=False,stream=False,
            report_path=None):
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
        # Never allow a caller's HTTP_PROXY/HTTPS_PROXY environment to redirect
        # ephemeral local gateway traffic (and its generated bearer key).
        direct_http=build_opener(ProxyHandler({})).open
        names=list(PROTOCOLS.values()) if protocol=='all' else [PROTOCOLS[protocol]]
        failed=0
        results=[]
        errors=(ValueError,KeyError,TypeError,AssertionError,RuntimeError)
        for name in names:
            outcome={'protocol':name,'text_and_tool_replay':'not_run',
                     'stream':'not_requested'}
            try:
                exercise(base,gateway_key,model,name,tools,False,opener=direct_http)
                outcome['text_and_tool_replay']='passed'
            except errors as exc:
                outcome['text_and_tool_replay']='failed_'+type(exc).__name__
                print('[FAIL]',name,'text/tools',type(exc).__name__,
                      file=sys.stderr,flush=True)
                failed+=1
            if stream:
                try:
                    exercise(base,gateway_key,model,name,False,True,opener=direct_http)
                    outcome['stream']='passed'
                except errors as exc:
                    outcome['stream']='failed_'+type(exc).__name__
                    print('[FAIL]',name,'stream',type(exc).__name__,
                          file=sys.stderr,flush=True)
                    failed+=1
            results.append(outcome)
        if report_path is not None:
            write_report(report_path,model,protocol,tools,stream,results,failed==0)
        if failed:
            print('Real-model qualification failed for',failed,'checks',file=sys.stderr)
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
    parser.add_argument('--report-json',default=None,
                        help='Write sanitized protocol results to a local owner-only JSON file')
    args=parser.parse_args()
    upstream=os.environ.get('YAG_REAL_UPSTREAM_URL','')
    model=os.environ.get('YAG_REAL_MODEL','')
    if not upstream or not model:
        parser.error('Set YAG_REAL_UPSTREAM_URL and YAG_REAL_MODEL explicitly')
    try:
        return qualify(args.host,upstream,model,
            os.environ.get('YAG_REAL_UPSTREAM_KEY',''),args.protocol,
            args.tools,args.stream,args.report_json)
    except OSError:
        print('[FAIL] Cannot write qualification report',file=sys.stderr)
        return 1
    except (ValueError,RuntimeError) as exc:
        # All error strings above are static and do not include secrets or URLs.
        print('[FAIL]',type(exc).__name__,str(exc),file=sys.stderr)
        return 1

if __name__=='__main__':
    sys.exit(main())
