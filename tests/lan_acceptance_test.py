#!/usr/bin/env python3
"""Offline two-client LAN acceptance checks without touching inference services."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from lan_acceptance import AcceptanceError, run_acceptance, save_report

MODEL='llama3.2:latest'
KEY_A='a'*48
KEY_B='b'*48


def config():
    return {
        'YAG_EXTRA_API_KEYS':KEY_A+','+KEY_B,
        'YAG_EXTRA_KEY_SCOPES':'inference+models,inference+models',
    }


class SimulatedGateway:
    def __init__(self):
        self.override=None
        self.models=True
        self.admin_status=404
        self.streaming_status=200
        self.chats=0

    def __call__(self, cfg, ca, path, key=None, payload=None, stream_cancel=False):
        if path=='/v1/models':
            if key is None:
                return 401,None
            if self.models:
                return 200,{'data':[{'id':MODEL}]}
            return 200,{'data':[]}
        if path=='/api/admin/clients':
            return self.admin_status,None
        if stream_cancel:
            return self.streaming_status,None
        if path=='/v1/chat/completions':
            self.chats+=1
            if self.override is not None:
                return self.override
            return 200,{'choices':[{'message':{
                'role':'assistant','content':'synthetic-private-model-response'}}]}
        raise AssertionError('Unexpected request path: '+path)


class TwoClientAcceptanceTests(unittest.TestCase):
    def test_two_keys_tls_isolation_and_reconnect_without_leaking_model_response(self):
        mock=SimulatedGateway()
        result=run_acceptance(config(),'not-used-by-the-mock',MODEL,make_request=mock)
        self.assertEqual(mock.chats,3)
        self.assertEqual(result['distinct_scoped_client_keys'],2)
        self.assertEqual(result['concurrent_chat_requests'],'passed')
        self.assertEqual(result['stream_open_and_client_close'],'passed')
        self.assertFalse(result['physical_two_pcs_qualified'])
        self.assertFalse(result['gpu_cancellation_verified'])
        self.assertFalse(result['backend_outage_recovery_verified'])
        self.assertEqual(result['model_id_sha256'],hashlib.sha256(MODEL.encode()).hexdigest())
        self.assertNotIn('synthetic-private',json.dumps(result))
        self.assertNotIn(KEY_A,json.dumps(result))
        self.assertNotIn(MODEL,json.dumps(result))

    def test_refuse_duplicate_keys_or_privileged_scope(self):
        bad=config()
        bad['YAG_EXTRA_API_KEYS']=KEY_A+','+KEY_A
        with self.assertRaises(AcceptanceError):
            run_acceptance(bad,None,MODEL,make_request=SimulatedGateway())
        bad=config()
        bad['YAG_EXTRA_KEY_SCOPES']='all,inference+models'
        with self.assertRaises(AcceptanceError):
            run_acceptance(bad,None,MODEL,make_request=SimulatedGateway())
        with self.assertRaises(AcceptanceError):
            run_acceptance(config(),None,'invalid model',make_request=SimulatedGateway())

    def test_refuse_missing_model_or_public_admin_endpoint(self):
        mock=SimulatedGateway()
        mock.models=False
        with self.assertRaisesRegex(AcceptanceError,'not present'):
            run_acceptance(config(),None,MODEL,make_request=mock)
        mock=SimulatedGateway()
        mock.admin_status=200
        with self.assertRaisesRegex(AcceptanceError,'exposed'):
            run_acceptance(config(),None,MODEL,make_request=mock)

    def test_refuse_stream_or_response_failures(self):
        mock=SimulatedGateway()
        mock.streaming_status=502
        with self.assertRaisesRegex(AcceptanceError,'Streaming'):
            run_acceptance(config(),None,MODEL,make_request=mock)
        mock=SimulatedGateway()
        mock.override=(200,{'choices':[]})
        with self.assertRaises(AcceptanceError):
            run_acceptance(config(),None,MODEL,make_request=mock)

    def test_private_nonoverwriting_evidence_file(self):
        mock=SimulatedGateway()
        result=run_acceptance(config(),None,MODEL,make_request=mock)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'acceptance.json'
            save_report(path,result)
            data=json.loads(path.read_text('utf-8'))
            self.assertEqual(data['schema_version'],1)
            if os.name=='posix':
                self.assertEqual(path.stat().st_mode & 0o777,0o600)
            with self.assertRaisesRegex(AcceptanceError,'overwrite'):
                save_report(path,result)
            target=Path(directory)/'target.txt'
            target.write_text('not changed')
            link=Path(directory)/'link.json'
            try: link.symlink_to(target)
            except (OSError,NotImplementedError):
                return
            with self.assertRaises(AcceptanceError):
                save_report(link,result)
            self.assertEqual(target.read_text(),'not changed')


if __name__=='__main__':
    unittest.main()
