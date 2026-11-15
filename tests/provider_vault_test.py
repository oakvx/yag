#!/usr/bin/env python3
"""Native encrypted provider vault regression suite; real age CLI is optional."""
import contextlib
import io
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import provider_vault as vault

RECIPIENT='age1'+'x'*55
SECRET='synthetic-secret-123456'


@unittest.skipUnless(os.name=='posix','Vault requires POSIX owner-only file semantics')
class VaultTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder=Path(self.tmp.name)
        self.path=self.folder/'keys.age'
        self.identity=self.folder/'identity.txt'
        self.identity.write_text('AGE-SECRET-KEY-FAKE')
        self.identity.chmod(0o600)

    @staticmethod
    def fake_age(cmd,input=None,**kwargs):
        if '--encrypt' in cmd:
            return subprocess.CompletedProcess(cmd,0,stdout=b'AGE\x00'+input)
        if '--decrypt' in cmd and input.startswith(b'AGE\x00'):
            return subprocess.CompletedProcess(cmd,0,stdout=input[4:])
        return subprocess.CompletedProcess(cmd,1,stdout=b'',stderr=b'')

    @contextlib.contextmanager
    def mock_age(self):
        with mock.patch.object(vault.shutil,'which',return_value='/usr/bin/age'):
            with mock.patch.object(vault.subprocess,'run',side_effect=self.fake_age):
                yield

    def test_initialize_rotate_aliases_and_redact_stdout(self):
        output=io.StringIO()
        with self.mock_age(),contextlib.redirect_stdout(output):
            self.assertEqual(vault.main(['init','--vault',str(self.path),
                                         '--recipient',RECIPIENT]),0)
            self.assertEqual(stat.S_IMODE(self.path.stat().st_mode),0o600)
            self.assertEqual(vault._read(self.path,self.identity),{})
            with mock.patch.object(vault.sys.stdin,'isatty',return_value=True):
                with mock.patch.object(vault.getpass,'getpass',return_value=SECRET):
                    self.assertEqual(vault.main(['set','--vault',str(self.path),
                      '--identity',str(self.identity),'--recipient',RECIPIENT,
                      '--alias','YAG_POOL_KEY_1']),0)
            self.assertEqual(vault._read(self.path,self.identity),
                             {'YAG_POOL_KEY_1':SECRET})
            self.assertNotIn(SECRET,self.path.read_bytes().decode('utf-8'))
            self.assertEqual(vault.main(['list','--vault',str(self.path),
                              '--identity',str(self.identity)]),0)
            self.assertEqual(vault.main(['rotate','--vault',str(self.path),
                  '--identity',str(self.identity),'--new-recipient',RECIPIENT]),0)
            self.assertEqual(vault._read(self.path,self.identity)['YAG_POOL_KEY_1'],SECRET)
            self.assertEqual(vault.main(['clear','--vault',str(self.path),
                  '--identity',str(self.identity),'--recipient',RECIPIENT,
                  '--alias','YAG_POOL_KEY_1']),0)
            self.assertEqual(vault._read(self.path,self.identity),{})
        self.assertNotIn(SECRET,output.getvalue())
        self.assertIn('YAG_POOL_KEY_1',output.getvalue())

    def test_native_exec_only_injects_aliases_and_discards_stale_env(self):
        exe=self.folder/'yag'
        exe.write_bytes(b'fixture binary')
        exe.chmod(0o700)
        with self.mock_age():
            vault._write_new(self.path,vault._encrypt({'YAG_POOL_KEY_1':SECRET},RECIPIENT))
            with mock.patch.dict(os.environ,{'YAG_POOL_KEY_2':'stale-secret'},clear=False):
                with mock.patch.object(vault.os,'execve') as execute:
                    self.assertEqual(vault.main(['exec','--vault',str(self.path),
                      '--identity',str(self.identity),'--host',str(exe)]),0)
                self.assertEqual(execute.call_count,1)
                binary,argv,environment=execute.call_args.args
                self.assertEqual(binary,str(exe))
                self.assertEqual(argv,[str(exe)])
                self.assertEqual(environment['YAG_POOL_KEY_1'],SECRET)
                self.assertNotIn('YAG_POOL_KEY_2',environment)

    def test_symlink_group_permissions_and_invalid_input_fail_closed(self):
        with self.mock_age():
            self.assertEqual(vault.main(['init','--vault',str(self.path),
                                         '--recipient',RECIPIENT]),0)
            self.path.chmod(0o644)
            with self.assertRaises(ValueError):
                vault._read(self.path,self.identity)
            self.path.chmod(0o600)
            link=self.folder/'linked.age'
            link.symlink_to(self.path)
            with self.assertRaises(ValueError):
                vault._read(link,self.identity)
            with self.assertRaises(ValueError):
                vault._encrypt({'YAG_POOL_KEY_9':SECRET},RECIPIENT)
            with self.assertRaises(ValueError):
                vault._encrypt({'YAG_POOL_KEY_1':'unsafe\nsecret'},RECIPIENT)
            with self.assertRaises(ValueError):
                vault._encrypt({'YAG_POOL_KEY_1':SECRET},'age1invalid')

    def test_non_tty_set_does_not_call_getpass(self):
        with self.mock_age():
            vault._write_new(self.path,vault._encrypt({},RECIPIENT))
            with mock.patch.object(vault.sys.stdin,'isatty',return_value=False):
                with mock.patch.object(vault.getpass,'getpass') as prompt:
                    with contextlib.redirect_stderr(io.StringIO()):
                        self.assertEqual(vault.main(['set','--vault',str(self.path),
                          '--identity',str(self.identity),'--recipient',RECIPIENT,
                          '--alias','YAG_POOL_KEY_1']),1)
                    prompt.assert_not_called()
            self.assertEqual(vault._read(self.path,self.identity),{})

    def test_age_failure_cannot_overwrite_existing_vault(self):
        with self.mock_age():
            vault._write_new(self.path,vault._encrypt({'YAG_POOL_KEY_1':SECRET},RECIPIENT))
        before=self.path.read_bytes()
        with mock.patch.object(vault.shutil,'which',return_value='/usr/bin/age'):
            with mock.patch.object(vault.subprocess,'run',
                     return_value=subprocess.CompletedProcess(['age'],1,stdout=b'')):
                with self.assertRaises(ValueError):
                    vault._encrypt({},RECIPIENT)
        self.assertEqual(self.path.read_bytes(),before)

    @unittest.skipUnless(shutil.which('age') and shutil.which('age-keygen'),
                         'age and age-keygen are not installed')
    def test_real_age_encrypt_decrypt_roundtrip(self):
        keyfile=self.folder/'real-age-identity'
        generation=subprocess.run(['age-keygen','-o',str(keyfile)],
                                  capture_output=True,check=False,timeout=15)
        self.assertEqual(generation.returncode,0)
        keyfile.chmod(0o600)
        content=keyfile.read_text()
        public=re.search(r'(?m)^# public key: (age1[0-9a-z]+)$',content)
        self.assertIsNotNone(public)
        vault._write_new(self.path,vault._encrypt({'YAG_POOL_KEY_1':SECRET},public.group(1)))
        self.assertNotIn(SECRET,self.path.read_bytes().decode('utf-8',errors='replace'))
        self.assertEqual(vault._read(self.path,keyfile),{'YAG_POOL_KEY_1':SECRET})


if __name__=='__main__':
    unittest.main()
