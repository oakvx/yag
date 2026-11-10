#!/usr/bin/env python3
"""Optional real Codex CLI probe against the deterministic mock upstream.

This is intentionally not part of ctest; it requires an installed Codex binary.
It exits nonzero if the client cannot complete a text turn through the gateway.
"""
import argparse
import json
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from integration import Backend, MockServer, KEY, UPKEY

parser = argparse.ArgumentParser()
parser.add_argument('--binary', default=shutil.which('codex'))
parser.add_argument('--host', required=True, help='Path to the built yag executable')
parser.add_argument('--tool-cycle', action='store_true', help='Request an actual client-side shell tool cycle')
args = parser.parse_args()
if not args.binary:
    parser.error('Codex was not found on PATH; pass --binary')
class ProbeBackend(Backend):
    def do_GET(self):
        if self.headers.get('Authorization') != 'Bearer ' + UPKEY:
            return self.send(401, {'error': {'message': 'bad upstream key'}})
        return self.send(200, {'object': 'list', 'data': [{'id': 'response-stream', 'owned_by': 'mock'}]})

class ToolBackend(ProbeBackend):
    tool_requested=False
    tool_completed=False
    def do_POST(self):
        if self.headers.get('Authorization') != 'Bearer ' + UPKEY:
            return self.send(401, {'error': {'message': 'bad upstream key'}})
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        messages=data.get('messages', [])
        if any(message.get('role')=='tool' for message in messages):
            ToolBackend.tool_completed=True
            print('Codex returned client-side tool output to the gateway',flush=True)
            chunk={'choices':[{'index':0,'delta':{'role':'assistant',
                'content':'Shell tool cycle completed.'},'finish_reason':None}]}
            final={'choices':[{'index':0,'delta':{},'finish_reason':'stop'}]}
            return self.stream_chunks([chunk,final])
        tools=data.get('tools',[])
        candidates=[]
        for tool in tools:
            fn=tool.get('function',{})
            name=fn.get('name','')
            if isinstance(name,str) and (
                name.endswith('__shell_command') or name.endswith('__exec_command')
                or name in ('shell_command','exec_command')
            ):
                candidates.append(fn)
        if not candidates:
            print('Codex did not supply an executable local shell tool:',[
                t.get('function',{}).get('name') for t in tools],flush=True)
            return self.send(400,{'error':{'message':'No suitable client shell tool in CLI request'}})
        fn=candidates[0]
        params=fn.get('parameters') or {}
        props=params.get('properties',{}) if isinstance(params,dict) else {}
        name=fn['name']
        if 'cmd' in props:
            cmd_spec=props['cmd']
            arguments={'cmd':['pwd'] if cmd_spec.get('type')=='array' else 'pwd'}
        elif 'command' in props:
            arguments={'command':'pwd'}
        else:
            print('Unknown shell tool input properties:',list(props),flush=True)
            return self.send(400,{'error':{'message':'Unknown shell input schema'}})
        if 'workdir' in props:
            arguments['workdir']=os.getcwd()
        for required in params.get('required',[]):
            if required in arguments:continue
            if required=='timeout':
                arguments[required]=1000
            elif required in props and props[required].get('type')=='boolean':
                arguments[required]=False
            else:
                print('Cannot fulfill required shell input field:',required,flush=True)
                return self.send(400,{'error':{'message':'Unsupported required shell input field'}})
        ToolBackend.tool_requested=True
        print('Codex shell tool selected:',name,flush=True)
        chunk={'choices':[{'index':0,'delta':{'role':'assistant','tool_calls':[
            {'index':0,'id':'call_yag_shell','type':'function',
             'function':{'name':name,'arguments':json.dumps(arguments)}}]},'finish_reason':None}]}
        final={'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls'}]}
        return self.stream_chunks([chunk,final])

    def stream_chunks(self, chunks):
        self.send_response(200)
        self.send_header('Content-Type','text/event-stream')
        self.end_headers()
        for chunk in chunks:
            self.wfile.write(('data: '+json.dumps(chunk)+'\n\n').encode())
            self.wfile.flush()
        self.wfile.write(b'data: [DONE]\n\n')
        self.wfile.flush()
        self.close_connection=True

backend = MockServer(('127.0.0.1', 0), ToolBackend if args.tool_cycle else ProbeBackend)
threading.Thread(target=backend.serve_forever, daemon=True).start()
with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
with tempfile.TemporaryDirectory() as work:
    home = os.path.join(work, 'codex-home')
    os.mkdir(home)
    with open(os.path.join(home, 'config.toml'), 'w', encoding='utf8') as f:
        f.write(f'''model = "response-stream"
model_provider = "yag"
web_search = "disabled"
[model_providers.yag]
name = "YAG Local"
base_url = "http://127.0.0.1:{port}/v1"
wire_api = "responses"
env_key = "YAG_API_KEY"
''')
    env = dict(os.environ, CODEX_HOME=home, YAG_API_KEY=KEY, YAG_UPSTREAM_KEY=UPKEY,
               YAG_BIND='127.0.0.1', YAG_PORT=str(port), YAG_TIMEOUT='5',
               YAG_UPSTREAM_URL=f'http://127.0.0.1:{backend.server_port}/v1',
               NO_PROXY='127.0.0.1,localhost')
    host = subprocess.Popen([os.path.abspath(args.host)], env=env)
    try:
        for _ in range(100):
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=.1): break
            except OSError: time.sleep(.03)
        prompt=('Run the local shell tool to print the current working directory, '
                'then report the result.' if args.tool_cycle else 'Reply with a greeting.')
        result = subprocess.run([args.binary, 'exec', '--skip-git-repo-check', '--sandbox', 'read-only',
                                 prompt], cwd=work, env=env, stdin=subprocess.DEVNULL,
                                timeout=45, check=False)
        exit_code = result.returncode
        if args.tool_cycle and exit_code==0 and not (ToolBackend.tool_requested and ToolBackend.tool_completed):
            print('Codex exited without completing the required client shell tool cycle',flush=True)
            exit_code=2
    finally:
        host.terminate()
        host.wait(timeout=5)
        backend.shutdown()
        backend.server_close()
raise SystemExit(exit_code)
