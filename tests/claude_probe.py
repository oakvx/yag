#!/usr/bin/env python3
"""Optional real Claude Code CLI smoke probe against an isolated local mock backend.

This is a compatibility diagnostic, not a test of model quality or real Claude API.
It does not use a production API key or access user data.
"""
import argparse
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

backend=MockServer(('127.0.0.1',0),Backend)
threading.Thread(target=backend.serve_forever,daemon=True).start()
with socket.socket() as listener:
    listener.bind(('127.0.0.1',0))
    port=listener.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='yag-claude-probe-') as work:
    env=dict(os.environ,
        HOME=work,
        ANTHROPIC_BASE_URL=f'http://127.0.0.1:{port}',
        ANTHROPIC_API_KEY=KEY,
        ANTHROPIC_DEFAULT_SONNET_MODEL='response-stream',
        ANTHROPIC_DEFAULT_OPUS_MODEL='response-stream',
        ANTHROPIC_DEFAULT_HAIKU_MODEL='response-stream',
        CLAUDE_CODE_SUBAGENT_MODEL='response-stream',
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
                 '--model','response-stream','--max-turns','1',
                 '--output-format','json']
        try:
            proc=subprocess.run(command,cwd=work,env=env,
                                stdin=subprocess.DEVNULL,
                                capture_output=True,text=True,timeout=45,check=False)
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
