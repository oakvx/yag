#!/usr/bin/env python3
"""Optional real Claude Code CLI smoke probe against an isolated local mock backend.

This is a compatibility diagnostic, not a test of model quality or real Claude API.
It does not use a production API key or access user data.
"""
import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from integration import Backend, KEY, UPKEY, MockServer, request

parser=argparse.ArgumentParser()
parser.add_argument('--host',required=True,help='Path to built YAG binary')
parser.add_argument('--binary',default=shutil.which('claude'))
args=parser.parse_args()
if not args.binary:
    parser.error('Claude Code CLI is not installed; pass --binary')

PROBE_MODEL='claude-sonnet-4-5-20250929'

class ClaudeProbeBackend(Backend):
    def do_POST(self):
        if self.headers.get('Authorization') != 'Bearer '+UPKEY:
            return self.send(401,{'error':{'message':'bad upstream key'}})
        data=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))))
        if data.get('model')!=PROBE_MODEL:
            return self.send(400,{'error':{'message':'probe model mismatch'}})
        if data.get('stream'):
            self.send_response(200)
            self.send_header('Content-Type','text/event-stream')
            self.end_headers()
            for choice in [
                {'choices':[{'index':0,'delta':{'role':'assistant','content':'Hello from YAG'},
                             'finish_reason':None}]},
                {'choices':[{'index':0,'delta':{},'finish_reason':'stop'}]}]:
                self.wfile.write(('data: '+json.dumps(choice)+'\n\n').encode())
                self.wfile.flush()
            self.wfile.write(b'data: [DONE]\n\n')
            self.wfile.flush()
            self.close_connection=True
            return
        return self.send(200,{'choices':[{'message':{'role':'assistant',
            'content':'Hello from YAG'},'finish_reason':'stop'}],
            'usage':{'prompt_tokens':10,'completion_tokens':4,'total_tokens':14}})

backend=MockServer(('127.0.0.1',0),ClaudeProbeBackend)
threading.Thread(target=backend.serve_forever,daemon=True).start()
with socket.socket() as listener:
    listener.bind(('127.0.0.1',0))
    port=listener.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='yag-claude-probe-') as work:
    env=dict(os.environ,
        HOME=work,
        ANTHROPIC_BASE_URL=f'http://127.0.0.1:{port}',
        ANTHROPIC_API_KEY=KEY,
        ANTHROPIC_DEFAULT_SONNET_MODEL=PROBE_MODEL,
        ANTHROPIC_DEFAULT_OPUS_MODEL=PROBE_MODEL,
        ANTHROPIC_DEFAULT_HAIKU_MODEL=PROBE_MODEL,
        CLAUDE_CODE_SUBAGENT_MODEL=PROBE_MODEL,
        ANTHROPIC_MODEL=PROBE_MODEL,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1',
        DISABLE_TELEMETRY='1',
        YAG_API_KEY=KEY,
        YAG_UPSTREAM_KEY=UPKEY,
        YAG_BIND='127.0.0.1',
        YAG_PORT=str(port),
        YAG_UPSTREAM_URL=f'http://127.0.0.1:{backend.server_port}/v1',
        YAG_TIMEOUT='10',
        NO_PROXY='127.0.0.1,localhost')
    for name in ('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'):
        env.pop(name,None)
    host=subprocess.Popen([os.path.abspath(args.host)],env=env,
                          stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            if host.poll() is not None:
                raise RuntimeError(host.stderr.read().decode())
            try:
                if request(port,'GET','/health',key=None)[0]==200:break
            except OSError:
                time.sleep(.03)
        else:
            raise RuntimeError('YAG did not start')
        command=[args.binary,'-p','Reply with a short greeting.',
                 '--model',PROBE_MODEL,'--max-turns','1',
                 '--output-format','json']
        try:
            proc=subprocess.run(command,cwd=work,env=env,
                                stdin=subprocess.DEVNULL,
                                capture_output=True,text=True,timeout=30,check=False)
            print('Claude Code stdout:',proc.stdout[-6000:],flush=True)
            print('Claude Code stderr:',proc.stderr[-6000:],flush=True)
            result=proc.returncode
        except subprocess.TimeoutExpired as exc:
            print('Claude Code probe timed out; diagnosing gateway activity',flush=True)
            for name,partial in [('stdout',exc.stdout),('stderr',exc.stderr)]:
                if partial:
                    output=partial.decode(errors='replace') if isinstance(partial,bytes) else partial
                    print('Partial '+name+':',output[-4000:],flush=True)
            try:
                metrics=request(port,'GET','/api/metrics')[2]
                print('Gateway metadata-only counters:',metrics.decode(),flush=True)
            except Exception as err:
                print('Could not retrieve gateway counters:',type(err).__name__,flush=True)
            result=124
    finally:
        host.terminate()
        host.wait(timeout=5)
        host.stderr.close()
        backend.shutdown()
        backend.server_close()
raise SystemExit(result)
