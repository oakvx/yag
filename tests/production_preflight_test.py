#!/usr/bin/env python3
"""Offline security preflight regressions; never require Docker, Caddy or credentials."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from production_preflight import evaluate, require_live_tls

ADMIN='a'*48
PC1='b'*48
PC2='c'*48


class PreflightTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path=Path(temp.name)/'.env.lan'
        self.write()

    def write(self, more='', scopes='inference+models,inference+models'):
        value=(
            'YAG_LAN_IP=192.168.50.10\n'
            'YAG_API_KEY='+ADMIN+'\n'
            'YAG_EXTRA_API_KEYS='+PC1+','+PC2+'\n'
            'YAG_EXTRA_KEY_SCOPES='+scopes+'\n'
            'YAG_UPSTREAM_URL=http://ollama:11434/v1\n'
            'YAG_RATE_LIMIT_PER_MINUTE=120\n' + more
        )
        self.path.write_text(value, encoding='utf-8')
        if os.name!='nt':self.path.chmod(0o600)

    def test_bootstrap_defaults_allowed_but_manual_review_required(self):
        result=evaluate(self.path)
        self.assertFalse(result['blocked'])
        self.assertTrue(result['manual_review_required'])
        ids={x['id'] for x in result['checks']}
        self.assertIn('firewall',ids)
        self.assertIn('hardware',ids)
        self.assertNotIn(ADMIN,json.dumps(result))
        self.assertNotIn(PC1,json.dumps(result))

    def test_duplicate_admin_key_is_blocked(self):
        self.write('YAG_API_KEY=another-key\n')
        result=evaluate(self.path)
        self.assertTrue(result['blocked'])
        self.assertIn('duplicate_config',{x['id'] for x in result['checks']})

    def test_rejects_broad_scopes_or_duplicate_client_keys(self):
        self.write(scopes='all,inference+models')
        self.assertTrue(evaluate(self.path)['blocked'])
        self.write()
        s=self.path.read_text().replace(PC2,PC1)
        self.path.write_text(s)
        self.assertTrue(evaluate(self.path)['blocked'])

    def test_rejects_cloud_default_and_invalid_local_address(self):
        self.write('YAG_FALLBACK_TO_DEFAULT=1\n')
        value=self.path.read_text().replace('http://ollama:11434/v1','https://api.example.com/v1')
        self.path.write_text(value)
        self.assertTrue(evaluate(self.path)['blocked'])

    def test_dedicated_cloud_must_have_private_key_and_request_ceiling(self):
        pool=[{'url':'https://api.example.com/v1','exclusive_models':True,
               'models':['provider/model'],'key_env':'YAG_POOL_KEY_1',
               'max_requests_per_run':50}]
        self.write('YAG_POOL_KEY_1=example-secret-key-123456\n'
                   'YAG_UPSTREAM_POOL='+json.dumps(pool,separators=(',',':'))+'\n')
        self.assertFalse(evaluate(self.path)['blocked'])
        pool[0]['max_requests_per_run']=0
        self.write('YAG_POOL_KEY_1=example-secret-key-123456\n'
                   'YAG_UPSTREAM_POOL='+json.dumps(pool,separators=(',',':'))+'\n')
        self.assertTrue(evaluate(self.path)['blocked'])

    def test_static_cloud_routes_fail_closed_before_client_rollout(self):
        routes=[{'model':'cloud-model','url':'https://api.example.com/v1',
                 'key_env':'YAG_CLOUD_SECRET'}]
        self.write('YAG_MODEL_ROUTES='+json.dumps(routes,separators=(',',':'))+'\n')
        result=evaluate(self.path)
        self.assertTrue(result['blocked'])
        self.assertIn('static_cloud_route',{x['id'] for x in result['checks']})
        self.assertNotIn('https://api.example.com',json.dumps(result))
        # Local/private static replicas remain valid.
        routes[0]['url']='http://ollama:11434/v1'
        self.write('YAG_MODEL_ROUTES='+json.dumps(routes,separators=(',',':'))+'\n')
        self.assertFalse(evaluate(self.path)['blocked'])
        self.write('YAG_MODEL_ROUTES=not-json\n')
        self.assertTrue(evaluate(self.path)['blocked'])

    def test_private_file_permissions_and_symlink(self):
        if os.name!='nt':
            self.path.chmod(0o644)
            with self.assertRaisesRegex(ValueError,'0600'):evaluate(self.path)
            self.path.chmod(0o600)
        link=self.path.parent/'symlink.env'
        try:link.symlink_to(self.path)
        except (OSError,NotImplementedError):
            self.skipTest('Symlinks unsupported')
        with self.assertRaisesRegex(ValueError,'non-symlink'):evaluate(link)

    def test_live_tls_checks_admin_hidden_even_for_primary_key(self):
        config={'YAG_API_KEY':ADMIN}
        observed=[]
        def mock_request(_config,path,key):
            observed.append((path,key))
            return {'/health':200,'/v1/models':401,'/api/admin/clients':404}[path]
        self.assertTrue(require_live_tls(config,mock_request))
        self.assertEqual(len(observed),3)
        with self.assertRaises(ValueError):
            require_live_tls(config,lambda *_:200)


if __name__=='__main__':
    unittest.main()
