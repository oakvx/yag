#!/usr/bin/env python3
"""Opt-in, privacy-preserving two-client HTTPS acceptance probe for real YAG LAN.

Never runs automatically. Uses two existing scoped PC keys from .env.lan and
the real trusted Caddy CA. It does NOT prove two physical PCs, backend GPU
load, completed cancellation, recovery from a deliberate outage or billing.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import socket
import ssl
import stat
import sys
import threading

from lan import CA_PATH, ENV_PATH, read_config, MODEL_PATTERN
from production_preflight import evaluate as preflight

MAX_RESPONSE=256*1024


class AcceptanceError(Exception):
    """Sanitized, actionable readiness failure (never includes responses)."""


def connection(config, ca_path):
    try:
        port=int(config.get('YAG_LAN_HTTPS_PORT','443'))
    except (TypeError, ValueError) as exc:
        raise AcceptanceError('Invalid LAN HTTPS port') from exc
    if not 1<=port<=65535:
        raise AcceptanceError('Invalid LAN HTTPS port')
    if Path(ca_path).is_symlink() or not Path(ca_path).is_file():
        raise AcceptanceError('Trusted public Caddy CA is missing or unsafe')
    try:
        context=ssl.create_default_context(cafile=str(ca_path))
    except (OSError, ssl.SSLError) as exc:
        raise AcceptanceError('Cannot initialize trusted CA') from exc
    return http.client.HTTPSConnection(config['YAG_LAN_IP'],port,timeout=70,context=context)


def fetch(config, ca_path, path, key=None, payload=None, stream_cancel=False,
          connect=connection):
    """Returns status + parsed data; never log or persist model content."""
    conn=connect(config,ca_path)
    headers={}
    if key is not None:
        headers['Authorization']='Bearer '+key
    body=None
    if payload is not None:
        headers['Content-Type']='application/json'
        body=json.dumps(payload,separators=(',',':'))
    try:
        conn.request('POST' if payload is not None else 'GET',path,body=body,headers=headers)
        response=conn.getresponse()
        status=response.status
        if stream_cancel:
            if status==200 and 'text/event-stream' not in response.getheader('Content-Type',''):
                raise AcceptanceError('Inference returned no SSE content type')
            response.read(1)  # Close transport while response may still be streaming.
            return status,None
        raw=response.read(MAX_RESPONSE+1)
        if len(raw)>MAX_RESPONSE:
            raise AcceptanceError('Gateway response exceeded the bounded acceptance limit')
        if status!=200:
            return status,None
        try:
            return status,json.loads(raw)
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise AcceptanceError('Gateway returned malformed JSON') from exc
    except (OSError, socket.timeout, ssl.SSLError, http.client.HTTPException) as exc:
        raise AcceptanceError('HTTPS transport or request failed') from exc
    finally:
        conn.close()


def run_acceptance(config, ca_path, model, *, make_request=fetch):
    if not isinstance(model,str) or not MODEL_PATTERN.fullmatch(model):
        raise AcceptanceError('Choose a valid exact installed Ollama model ID')
    keys=config.get('YAG_EXTRA_API_KEYS','').split(',')
    scopes=config.get('YAG_EXTRA_KEY_SCOPES','').split(',')
    if (len(keys)<2 or len(scopes)<2 or len(set(keys[:2]))!=2
            or any(len(key)<32 for key in keys[:2])
            or any(scope != 'inference+models' for scope in scopes[:2])):
        raise AcceptanceError('Two different scoped inference+models client keys are required')
    client_keys=keys[:2]
    # The check covers the router path rather than direct/untested inference.
    for key in client_keys:
        status,inventory=make_request(config,ca_path,'/v1/models',key=key)
        if status!=200 or not isinstance(inventory,dict):
            raise AcceptanceError('A scoped client cannot discover models')
        listing=inventory.get('data')
        if not isinstance(listing,list) or not any(
                isinstance(item,dict) and item.get('id')==model for item in listing):
            raise AcceptanceError('Model is not present in this client model inventory')
        status,_=make_request(config,ca_path,'/api/admin/clients',key=key)
        if status!=404:
            raise AcceptanceError('Local-only administration is exposed via LAN HTTPS')
    status,_=make_request(config,ca_path,'/v1/models')
    if status!=401:
        raise AcceptanceError('Unauthenticated model discovery was not denied')

    barrier=threading.Barrier(2)
    def one_chat(key):
        barrier.wait(timeout=5)
        status,data=make_request(config,ca_path,'/v1/chat/completions',key=key,payload={
            'model':model,'messages':[{'role':'user','content':'Reply with the word OK.'}],
            'max_tokens':24,'stream':False})
        if status!=200 or not isinstance(data,dict):
            raise AcceptanceError('Concurrent inference failed for a scoped client')
        choices=data.get('choices')
        if not isinstance(choices,list) or not choices or not isinstance(choices[0],dict):
            raise AcceptanceError('Invalid concurrent inference response structure')
        msg=choices[0].get('message')
        if not isinstance(msg,dict) or msg.get('role')!='assistant':
            raise AcceptanceError('Concurrent inference returned no assistant message')
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(one_chat,key) for key in client_keys]
        for future in futures:
            try:
                future.result(timeout=90)
            except (threading.BrokenBarrierError, TimeoutError) as exc:
                raise AcceptanceError('Two-client request synchronization or inference timed out') from exc
    stream_status,_=make_request(config,ca_path,'/v1/chat/completions',
        key=client_keys[0],payload={
            'model':model,
            'messages':[{'role':'user','content':'Write a short paragraph about trees.'}],
            'max_tokens':64,'stream':True},stream_cancel=True)
    if stream_status!=200:
        raise AcceptanceError('Streaming transport could not be opened and closed')
    # This verifies the server still responds after a client disconnect. It
    # does NOT prove that upstream GPU work was actually cancelled.
    follow_up_status,follow_up=make_request(config,ca_path,'/v1/chat/completions',
        key=client_keys[1],payload={
            'model':model,'messages':[{'role':'user','content':'Reply OK.'}],
            'max_tokens':16,'stream':False})
    if follow_up_status!=200 or not isinstance(follow_up,dict) or not follow_up.get('choices'):
        raise AcceptanceError('Gateway did not recover from a client-side stream close')
    return {
        'schema_version':1,
        'source':'manual_two_client_lan_acceptance',
        'measured_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'model_id_sha256':hashlib.sha256(model.encode('utf-8')).hexdigest(),
        'distinct_scoped_client_keys':2,
        'model_discovery':'passed',
        'admin_lan_isolation':'passed',
        'anonymous_access_denied':'passed',
        'concurrent_chat_requests':'passed',
        'stream_open_and_client_close':'passed',
        'post_close_gateway_response':'passed',
        'physical_two_pcs_qualified':False,
        'gpu_cancellation_verified':False,
        'backend_outage_recovery_verified':False,
    }


def save_report(path, report):
    path=Path(path)
    if not path.is_absolute() or path.is_symlink():
        raise AcceptanceError('Report destination must be an absolute private path')
    if path.exists():
        raise AcceptanceError('Refusing to overwrite existing acceptance evidence')
    flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL
    if hasattr(os,'O_NOFOLLOW'):flags|=os.O_NOFOLLOW
    fd=os.open(path,flags,0o600)
    try:
        if os.name=='posix':
            os.fchmod(fd,0o600)
        with os.fdopen(fd,'w',encoding='utf-8') as stream:
            json.dump(report,stream,sort_keys=True,separators=(',',':'))
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model',required=True,help='An exact local model ID (no cloud calls)')
    parser.add_argument('--report-json',type=Path,help='New private local report path, never GitHub')
    args=parser.parse_args(argv)
    try:
        config=read_config()
        findings=preflight(ENV_PATH,CA_PATH)
        if findings['blocked']:
            raise AcceptanceError('LAN security preflight blocks acceptance checks')
        result=run_acceptance(config,CA_PATH,args.model)
        if args.report_json:
            save_report(args.report_json,result)
        print('PASS: two distinct scoped keys, real concurrent inference, TLS and stream-close recovery.')
        print('NOTE: physical PCs, GPU cancellation and deliberate backend outages remain unverified.')
        return 0
    except (OSError, ValueError, AcceptanceError) as exc:
        print('LAN ACCEPTANCE BLOCKED:',str(exc) if isinstance(exc,AcceptanceError)
              else 'Invalid or inaccessible private LAN configuration',file=sys.stderr)
        return 1


if __name__=='__main__':
    sys.exit(main())
