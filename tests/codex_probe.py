#!/usr/bin/env python3
"""Optional real Codex CLI probe against the deterministic mock upstream.

This is intentionally not part of ctest; it requires an installed Codex binary.
It exits nonzero if the client cannot complete a text turn through the gateway.
"""
import argparse
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
args = parser.parse_args()
if not args.binary:
    parser.error('Codex was not found on PATH; pass --binary')
class ProbeBackend(Backend):
    def do_GET(self):
        if self.headers.get('Authorization') != 'Bearer ' + UPKEY:
            return self.send(401, {'error': {'message': 'bad upstream key'}})
        return self.send(200, {'object': 'list', 'data': [{'id': 'response-stream', 'owned_by': 'mock'}]})

backend = MockServer(('127.0.0.1', 0), ProbeBackend)
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
        result = subprocess.run([args.binary, 'exec', '--skip-git-repo-check', '--sandbox', 'read-only',
                                 'Reply with a greeting.'], cwd=work, env=env, stdin=subprocess.DEVNULL,
                                timeout=45, check=False)
        exit_code = result.returncode
    finally:
        host.terminate()
        host.wait(timeout=5)
        backend.shutdown()
        backend.server_close()
raise SystemExit(exit_code)
