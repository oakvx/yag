#!/usr/bin/env python3
"""No-network tests for first prerelease tag and trusted CI gating."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from release_candidate import validate, main

SHA='a'*40


def run(name, *, number=2, result='success', status='completed'):
    return {'name':name,'head_sha':SHA,'head_branch':'main',
            'event':'push','head_repository':{'full_name':'oakvx/yag'},
            'status':status,'conclusion':result,'run_number':number,'run_attempt':1}


def fixtures():
    return {'workflow_runs':[run('CI'),run('Security and dependency review')]}


class CandidatePolicyTests(unittest.TestCase):
    def test_exact_main_sha_and_successful_gate(self):
        self.assertTrue(validate('v0.1.0-rc.1',SHA,fixtures()))
        self.assertTrue(validate('v4.15.23-rc.39',SHA,fixtures()))

    def test_weekly_tags_require_opt_in_and_real_monday(self):
        tag = 'v0.1.0-weekly.20261116'
        self.assertTrue(validate(tag, SHA, fixtures(), weekly=True))
        with self.assertRaises(ValueError):
            validate(tag, SHA, fixtures())
        for invalid in (
            'v0.1.0-weekly.20261115',  # Sunday
            'v0.1.0-weekly.20260230',  # Invalid date
            'v0.1.0-weekly.20261116;echo',
            'v0.1.0-weekly.202611160',
            'v0.1.0-weekly.20261123-rc.1',
            'v0.1.0',
        ):
            with self.subTest(tag=invalid), self.assertRaises(ValueError):
                validate(invalid, SHA, fixtures(), weekly=True)

    def test_weekly_still_requires_exact_main_ci_and_security(self):
        data = fixtures()
        data['workflow_runs'].append(run('Security and dependency review', number=4, result='failure'))
        with self.assertRaisesRegex(ValueError, 'Latest'):
            validate('v0.1.0-weekly.20261116', SHA, data, weekly=True)

    def test_dangerous_tags_rejected(self):
        for tag in ('v0.1.0','v0.1.0-rc.0','v0.1.0-rc.1;whoami',
                    'v00.1.0-rc.1','v1.02.0-rc.1','v1.2.3-rc.01',
                    'refs/tags/v0.1.0-rc.1','v1.1.1-beta.1'):
            with self.subTest(tag=tag),self.assertRaises(ValueError):
                validate(tag,SHA,fixtures())

    def test_older_green_run_does_not_override_new_failure(self):
        data=fixtures()
        data['workflow_runs'].append(run('CI',number=3,result='failure'))
        with self.assertRaisesRegex(ValueError,'Latest'):
            validate('v0.1.0-rc.1',SHA,data)
        data['workflow_runs'][-1]['result']='success' # wrong field cannot bypass
        with self.assertRaises(ValueError):
            validate('v0.1.0-rc.1',SHA,data)
        data['workflow_runs'][-1]['conclusion']='success'
        self.assertTrue(validate('v0.1.0-rc.1',SHA,data))

    def test_refuse_untrusted_pr_fork_branch_or_commit(self):
        for field,value in (
            ('event','pull_request'),
            ('head_branch','feature'),
            ('head_sha','b'*40),
            ('head_repository',{'full_name':'untrusted/fork'}),
            ('status','in_progress'),
            ('conclusion','cancelled'),
        ):
            with self.subTest(field=field):
                data=fixtures()
                for run_item in data['workflow_runs']:
                    run_item[field]=value
                with self.assertRaises(ValueError):
                    validate('v0.1.0-rc.1',SHA,data)

    def test_reject_missing_security_and_bad_commit(self):
        with self.assertRaises(ValueError):
            validate('v0.1.0-rc.1',SHA,{'workflow_runs':[run('CI')]})
        with self.assertRaises(ValueError):
            validate('v0.1.0-rc.1','not-a-sha',fixtures())
        with self.assertRaises(ValueError):
            validate('v0.1.0-rc.1',SHA,{'workflow_runs':'fake'})

    def test_cli_rejects_symlink_and_accepts_private_fixture(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'runs.json'
            path.write_text(json.dumps(fixtures()))
            self.assertEqual(main(['--tag','v0.1.0-rc.1','--commit',SHA,
                                   '--runs-file',str(path)]),0)
            link=Path(folder)/'link.json'
            try:link.symlink_to(path)
            except (OSError,NotImplementedError):
                return
            self.assertEqual(main(['--tag','v0.1.0-rc.1','--commit',SHA,
                                   '--runs-file',str(link)]),1)


if __name__=='__main__':
    unittest.main()
