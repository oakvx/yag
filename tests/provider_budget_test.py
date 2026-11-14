#!/usr/bin/env python3
"""Offline USD price assumptions, provenance, and request allowance checks."""
import contextlib
import datetime
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1] / 'scripts'))
from provider_budget import estimate
import lan

NOW=datetime.datetime(2026,11,15,tzinfo=datetime.timezone.utc)


def example_policy():
    return {
        'schema_version':1,
        'model_id':'provider/my-model',
        'currency':'USD',
        'source_url':'https://example.com/pricing',
        'checked_at_utc':'2026-11-14T12:00:00+00:00',
        'input_usd_per_million':'2.00',
        'output_usd_per_million':'6.00',
        'assumed_max_input_tokens':5000,
        'assumed_max_output_tokens':1000,
        'safety_multiplier':'2.0',
        'planning_budget_usd':'1.00',
    }


class ProviderBudgetTest(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.directory=Path(tmp.name)
        self.path=self.directory/'pricing.json'
        self.save(example_policy())

    def save(self,policy):
        self.path.write_text(json.dumps(policy),encoding='utf-8')

    def test_exact_decimal_allowance_is_conservative(self):
        info=estimate(self.path,now=NOW)
        self.assertEqual(info['suggested_max_requests_per_run'],31)
        self.assertEqual(info['estimated_worst_case_usd'],'0.032')
        self.assertIn('not a financial',info['warning'])

    def test_reject_stale_malformed_missing_provenance_or_dangerous_prices(self):
        changes=[
            {'currency':'EUR'},
            {'source_url':'http://example.com/pricing'},
            {'source_url':'https://key:secret@example.com/pricing'},
            {'checked_at_utc':'2026-01-01T12:00:00+00:00'},
            {'checked_at_utc':'2026-11-20T12:00:00+00:00'},
            {'input_usd_per_million':'NaN'},
            {'output_usd_per_million':'-0.3'},
            {'safety_multiplier':'1.0'},
            {'planning_budget_usd':'0.0000001'},
            {'assumed_max_output_tokens':0},
            {'model_id':'invalid model name'},
        ]
        for patch_data in changes:
            with self.subTest(data=patch_data),self.assertRaises(ValueError):
                self.save(dict(example_policy(),**patch_data))
                estimate(self.path,now=NOW)

    def test_reject_extra_fields_and_symlinks(self):
        self.save(dict(example_policy(),secret='must not be stored'))
        with self.assertRaises(ValueError):estimate(self.path,now=NOW)
        self.save(example_policy())
        link=self.directory/'link.json'
        try:link.symlink_to(self.path)
        except (OSError,NotImplementedError):
            self.skipTest('Symlink unsupported')
        with self.assertRaises(ValueError):estimate(link,now=NOW)

    def test_cli_applies_estimated_ceiling_without_exposing_credentials(self):
        # Use a fresh timestamp for CLI, which checks against actual UTC now.
        policy=example_policy()
        policy['checked_at_utc']=datetime.datetime.now(
            datetime.timezone.utc).isoformat(timespec='seconds')
        self.save(policy)
        envfile=self.directory/'.env.lan'
        envfile.write_text('YAG_LAN_IP=192.168.10.20\n'
             'YAG_API_KEY='+'a'*48+'\n'
             'YAG_EXTRA_API_KEYS='+'b'*48+'\n'
             'YAG_EXTRA_KEY_SCOPES=inference+models\n'
             'YAG_UPSTREAM_URL=http://ollama:11434/v1\n')
        if os.name!='nt':envfile.chmod(0o600)
        with patch.object(lan,'ENV_PATH',envfile),patch.object(lan,'configure_provider') as submit:
            output=io.StringIO()
            with contextlib.redirect_stdout(output):
                result=lan.main(['providers','add','--url','https://api.example.com/v1',
                      '--key-env','YAG_POOL_KEY_1','--model','provider/my-model',
                      '--exclusive-models','--pricing-policy',str(self.path)])
            self.assertEqual(result,0)
            self.assertEqual(submit.call_args.args[-1],31)
            self.assertIn('not a financial',output.getvalue())
            self.assertNotIn('a'*48,output.getvalue())
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(lan.main(['providers','add','--url','https://api.example.com/v1',
                      '--key-env','YAG_POOL_KEY_1','--model','other/model',
                      '--exclusive-models','--pricing-policy',str(self.path)]),1)
            self.assertEqual(submit.call_count,1)


if __name__=='__main__':
    unittest.main()
