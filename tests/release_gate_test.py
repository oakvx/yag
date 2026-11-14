#!/usr/bin/env python3
"""Security regression checks for reviewed real-model evidence (offline)."""
import copy
import datetime
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from release_gate import evaluate

SHA = 'a' * 40


def valid_report():
    return {
        'schema_version': 2,
        'source': 'real_upstream_gateway_probe',
        'measured_at_utc': '2026-11-14T20:00:00+00:00',
        'gateway_commit': SHA,
        'model_id_sha256': 'b' * 64,
        'protocol_selection': 'all',
        'stream_requested': True,
        'tool_replay_requested': True,
        'qualified': True,
        'scope': 'exact_model_runtime_configuration',
        'runtime': {'os':'linux', 'architecture':'x86_64',
                    'gpu': {'source':'nvidia-smi','name':'NVIDIA Example',
                            'driver_version':'575.10.1','memory_total_mib': 24000},
                    'ollama_cli_version':'ollama version 0.1.0'},
        'results': [{'protocol':p,'text_and_tool_replay':'passed','stream':'passed'}
                    for p in ('chat/completions','responses','messages')],
    }


class ReleaseGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'evidence.json'
        self.now = datetime.datetime(2026,11,15,tzinfo=datetime.timezone.utc)

    def run_case(self, data, *, gpu=True):
        self.path.write_text(json.dumps(data), encoding='utf-8')
        return evaluate(self.path, SHA, now=self.now, require_gpu=gpu)

    def test_real_full_evidence_accepted(self):
        result = self.run_case(valid_report())
        self.assertEqual(result['protocol_count'],3)
        self.assertEqual(result['model_id_sha256'],'b'*64)

    def test_partial_and_unverified_fails_closed(self):
        cases = [
            {'qualified':False}, {'source':'operator_configuration'},
            {'gateway_commit':'c'*40}, {'schema_version':1},
            {'model_id_sha256':'invalid'}, {'scope':'other'},
            {'protocol_selection':'chat'}, {'stream_requested':False},
            {'tool_replay_requested':False}, {'results':[]},
            {'measured_at_utc':'2020-01-01T00:00:00+00:00'},
            {'measured_at_utc':'2026-11-16T00:00:00+00:00'},
            {'measured_at_utc':'2026-11-14T20:00:00'},
            {'runtime':{'os':'windows','architecture':'x64','gpu':None}},
        ]
        for change in cases:
            with self.subTest(change=change):
                self.assertRaises(ValueError, self.run_case,
                    dict(valid_report(), **change))

    def test_duplicate_protocol_and_failed_stream(self):
        data=valid_report()
        data['results'][1]['protocol']='chat/completions'
        with self.assertRaises(ValueError):self.run_case(data)
        data=valid_report()
        data['results'][2]['stream']='failed_RuntimeError'
        with self.assertRaises(ValueError):self.run_case(data)

    def test_gpu_evidence_is_required_for_colibri(self):
        data=valid_report()
        data['runtime']['gpu']=None
        with self.assertRaisesRegex(ValueError,'NVIDIA'):
            self.run_case(data)
        self.assertFalse(self.run_case(data,gpu=False)['gpu_evidence_present'])
        data=valid_report()
        data['runtime']['gpu']['driver_version']='unknown'
        with self.assertRaises(ValueError):self.run_case(data)

    def test_invalid_permissions_and_symlink(self):
        self.run_case(valid_report())
        alias=self.path.parent/'alias.json'
        try:alias.symlink_to(self.path)
        except (NotImplementedError,OSError):
            self.skipTest('No symlink support')
        with self.assertRaisesRegex(ValueError,'non-symlink'):
            evaluate(alias,SHA,now=self.now)
        self.path.write_bytes(b'x' * (16*1024+1))
        with self.assertRaisesRegex(ValueError,'size limit'):
            evaluate(self.path,SHA,now=self.now)

    def test_invalid_commit_and_expired(self):
        self.run_case(valid_report())
        with self.assertRaises(ValueError):evaluate(self.path,'unknown',now=self.now)
        with self.assertRaisesRegex(ValueError,'stale'):
            evaluate(self.path,SHA,now=self.now+datetime.timedelta(days=40))


if __name__=='__main__':
    unittest.main()
