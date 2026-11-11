#!/usr/bin/env python3
"""Opt-in real-model interoperability probe. Does not dump prompt bodies or keys.

Requirements:
  YAG_REAL_UPSTREAM_URL (OpenAI-compatible /v1 base)
  YAG_REAL_MODEL (an actual model served by that backend)
  YAG_REAL_UPSTREAM_KEY (optional)
Use --tools only for backends that claim Chat function tools. This test
runs locally; it is intentionally NOT part of mock-only CI.
"""
import argparse
import json
import os
import socket
import subprocess
import sys
import time
from integration import KEY, request

parser=argparse.ArgumentParser()
parser.add_argument('--host',required=True)
parser.add_argument('--tools',action='store_true')
args=parser.parse_args()
upstream=os.environ.get('YAG_REAL_UPSTREAM_URL')
model=os.environ.get('YAG_REAL_MODEL')
if not upstream or not model:
    parser.error('Set YAG_REAL_UPSTREAM_URL and YAG_REAL_MODEL explicitly')
if not upstream.startswith(('http://','https://')):
    parser.error('YAG_REAL_UPSTREAM_URL must be HTTP(S)')
if upstream.endswith('/'):
    parser.error('YAG_REAL_UPSTREAM_URL must not have trailing slash')
with socket.socket() as s:
    s.bind(('127.0.0.1',0))
    port=s.getsockname()[1]
env=dict(os.environ,YAG_BIND='127.0.0.1',YAG_PORT=str(port),
         YAG_API_KEY=KEY,YAG_UPSTREAM_URL=upstream,
         YAG_UPSTREAM_KEY=os.environ.get('YAG_REAL_UPSTREAM_KEY',''),
         YAG_TIMEOUT='60')
gateway=subprocess.Popen([os.path.abspath(args.host)],env=env,
                         stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    for _ in range(150):
        if gateway.poll() is not None:
            raise AssertionError('Gateway terminated before readiness')
        try:
            if request(port,'GET','/health',key=None)[0]==200:break
        except OSError:time.sleep(.04)
    else:raise AssertionError('Gateway startup timed out')

    print('Checking real model Chat Completions nonstreaming response...',flush=True)
    payload={'model':model,'messages':[{'role':'user',
            'content':'Reply with exactly OK.'}],'max_tokens':64}
    status,_,body=request(port,'POST','/v1/chat/completions',payload)
    if status!=200:
        raise AssertionError(f'Chat nonstreaming HTTP {status}; check model support')
    obj=json.loads(body)
    choices=obj.get('choices',[])
    if not choices or not isinstance(choices[0].get('message',{}).get('content'),str):
        raise AssertionError('Chat response is not a text assistant message')

    print('Checking real model streaming responses...',flush=True)
    payload['stream']=True
    status,headers,data=request(port,'POST','/v1/chat/completions',payload)
    if status!=200 or 'text/event-stream' not in headers.get('Content-Type',''):
        raise AssertionError(f'Chat streaming HTTP {status} with unexpected MIME')
    if b'[DONE]' not in data:
        raise AssertionError('Chat SSE stream did not terminate with [DONE]')

    print('Checking Responses adapter against the real model...',flush=True)
    status,_,body=request(port,'POST','/v1/responses',
        {'model':model,'input':'Reply with OK.','max_output_tokens':64})
    if status!=200 or json.loads(body).get('object')!='response':
        raise AssertionError(f'Responses adapter HTTP {status} or invalid object')

    if args.tools:
        print('Checking real model function tool selection...',flush=True)
        tools=[{'type':'function','function':{
            'name':'return_temperature',
            'description':'Return the requested temperature for a city',
            'parameters':{'type':'object','properties':{
                'city':{'type':'string'}},'required':['city']}}}]
        status,_,body=request(port,'POST','/v1/chat/completions',{
            'model':model,'messages':[{'role':'user',
              'content':'Call return_temperature for Rome.'}],
            'tools':tools,'tool_choice':{'type':'function',
              'function':{'name':'return_temperature'}},'max_tokens':128})
        if status!=200:raise AssertionError(f'Tool selection HTTP {status}')
        choices=json.loads(body).get('choices',[])
        calls=choices[0].get('message',{}).get('tool_calls',[]) if choices else []
        if not calls or calls[0].get('function',{}).get('name')!='return_temperature':
            raise AssertionError('Real model failed to select required function tool')

    print('PASS: requested real-model integration probe checks',flush=True)
finally:
    gateway.terminate()
    try:gateway.wait(timeout=10)
    except subprocess.TimeoutExpired:
        gateway.kill()
        gateway.wait(timeout=5)
