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
parser.add_argument('--tool-cycle',action='store_true',help='Run a real client-side Read tool cycle')
args=parser.parse_args()
if not args.binary:
    parser.error('Claude Code CLI is not installed; pass --binary')

PROBE_MODEL='claude-sonnet-4-5-20250929'

class ClaudeProbeBackend(Backend):
    tool_requested=False
    tool_completed=False
    def stream(self,chunks):
        self.send_response(200)
        self.send_header('Content-Type','text/event-stream')
        self.end_headers()
        for choice in chunks:
            self.wfile.write(('data: '+json.dumps(choice)+'\n\n').encode())
            self.wfile.flush()
        self.wfile.write(b'data: [DONE]\n\n')
        self.wfile.flush()
        self.close_connection=True

    def do_POST(self):
        if self.headers.get('Authorization') != 'Bearer '+UPKEY:
            return self.send(401,{'error':{'message':'bad upstream key'}})
        data=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))))
        if data.get('model')!=PROBE_MODEL:
            return self.send(400,{'error':{'message':'probe model mismatch'}})
        if args.tool_cycle:
            messages=data.get('messages',[])
            results=[m for m in messages if m.get('role')=='tool']
            if results:
                if not any('YAG_CLAUDE_PROBE_READ_OK' in str(m.get('content','')) for m in results):
                    return self.send(400,{'error':{'message':'Mock did not receive expected Read output'}})
                ClaudeProbeBackend.tool_completed=True
                print('Claude Code returned the expected local Read tool output',flush=True)
                return self.stream([
                    {'choices':[{'index':0,'delta':{'role':'assistant',
                        'content':'Claude Code Read tool cycle completed.'},
                        'finish_reason':None}]},
                    {'choices':[{'index':0,'delta':{},'finish_reason':'stop'}]}])
            available=[t.get('function',{}) for t in data.get('tools',[])]
            read=[fn for fn in available if fn.get('name')=='Read']
            if not read:
                print('No Read tool; available client tool names:',
                      [fn.get('name') for fn in available][:40],flush=True)
                return self.send(400,{'error':{'message':'Claude Code did not declare Read tool'}})
            params=read[0].get('parameters',{})
            props=params.get('properties',{})
            if 'file_path' not in props:
                print('Read tool schema properties:',list(props),flush=True)
                return self.send(400,{'error':{'message':'Unexpected Read tool schema'}})
            arguments={'file_path':os.path.join(work,'yag_claude_probe.txt')}
            ClaudeProbeBackend.tool_requested=True
            print('Requested local Read through Claude Code',flush=True)
            return self.stream([
                {'choices':[{'index':0,'delta':{'role':'assistant',
                    'tool_calls':[{'index':0,'id':'toolu_yag_read_01',
                      'type':'function','function':{'name':'Read',
                           'arguments':json.dumps(arguments)}}]},'finish_reason':None}]},
                {'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls'}]}])
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
        ANTHROPIC_AUTH_TOKEN=KEY,
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
        YAG_TIMEOUT='10',YAG_TRACE_ROUTES='1',
        YAG_TRACE_ANTHROPIC_SHAPE='1',
        NO_PROXY='127.0.0.1,localhost')
    for name in ('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'):
        env.pop(name,None)
    if args.tool_cycle:
        with open(os.path.join(work,'yag_claude_probe.txt'),'w',encoding='utf-8') as fixture:
            fixture.write('YAG_CLAUDE_PROBE_READ_OK\n')
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
        prompt=('Use the Read tool to open yag_claude_probe.txt, then confirm it was read.'
                if args.tool_cycle else 'Reply with a short greeting.')
        command=[args.binary,'-p',prompt,
                 '--model',PROBE_MODEL,'--max-turns','3' if args.tool_cycle else '1',
                 '--output-format','json']
        if args.tool_cycle:
            command.extend(['--allowedTools','Read'])
        try:
            proc=subprocess.run(command,cwd=work,env=env,
                                stdin=subprocess.DEVNULL,
                                capture_output=True,text=True,timeout=30,check=False)
            print('Claude Code stdout:',proc.stdout[-6000:],flush=True)
            print('Claude Code stderr:',proc.stderr[-6000:],flush=True)
            result=proc.returncode
            if args.tool_cycle and result==0 and not (
                    ClaudeProbeBackend.tool_requested and ClaudeProbeBackend.tool_completed):
                print('Claude Code exited without completing the required local Read cycle',
                      flush=True)
                result=2
            if result:
                try:
                    metrics=request(port,'GET','/api/metrics')[2]
                    print('Gateway metadata-only counters:',metrics.decode(),flush=True)
                except Exception as err:
                    print('Gateway status could not be read:',type(err).__name__,flush=True)
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
        output=host.stderr.read().decode(errors='replace')
        print('Gateway route-only trace:',output[-4000:],flush=True)
        host.stderr.close()
        backend.shutdown()
        backend.server_close()
raise SystemExit(result)
