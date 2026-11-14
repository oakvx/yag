#!/usr/bin/env python3
"""Fail-closed policy fixtures for the release's trusted Colibri run."""
import copy
import sys
from pathlib import Path
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from verify_colibri_run import validate_run

SHA="a"*40


def fixtures():
    run={
        "head_sha":SHA,"head_branch":"main","event":"workflow_dispatch",
        "status":"completed","conclusion":"success",
        "path":".github/workflows/live-model.yml",
        "repository":{"full_name":"oakvx/yag"}
    }
    names=[
        "Verify runner setup without printing private configuration",
        "Build isolated gateway on the runner",
        "Qualify actual inference and model protocols",
        "Reject incomplete release-candidate qualification",
    ]
    jobs={"jobs":[{
        "name":"Real model / real inference backend",
        "status":"completed","conclusion":"success",
        "runner_name":"private-ci-01",
        "labels":["self-hosted","linux","x64","yag-colibri"],
        "steps":[{"name":name,"conclusion":"success"} for name in names],
    }]}
    return run,jobs


class TrustedColibriRunTests(unittest.TestCase):
    def test_exact_run_and_verified_runner(self):
        run,jobs=fixtures()
        self.assertTrue(validate_run(run,jobs,SHA))

    def test_wrong_workflow_branch_source_or_commit(self):
        for delta in [
            {"event":"pull_request"},
            {"head_branch":"feature"},
            {"head_sha":"b"*40},
            {"conclusion":"failure"},
            {"status":"in_progress"},
            {"path":".github/workflows/ci.yml"},
            {"repository":{"full_name":"external/fork"}},
        ]:
            with self.subTest(delta=delta):
                run,jobs=fixtures()
                run.update(delta)
                with self.assertRaises(ValueError):
                    validate_run(run,jobs,SHA)

    def test_no_untrusted_runner_or_incomplete_step(self):
        for change in [
            {"runner_name":None},
            {"labels":["self-hosted","linux"]},
            {"labels":["ubuntu-latest"]},
            {"conclusion":"failure"},
            {"name":"Untrusted PR job"},
            {"steps":[]},
        ]:
            with self.subTest(change=change):
                run,jobs=fixtures()
                jobs["jobs"][0].update(change)
                with self.assertRaises(ValueError):
                    validate_run(run,jobs,SHA)
        run,jobs=fixtures()
        jobs["jobs"][0]["steps"][-1]["conclusion"]="skipped"
        with self.assertRaises(ValueError):
            validate_run(run,jobs,SHA)

    def test_rejects_incorrect_jobs_count_and_invalid_sha(self):
        run,jobs=fixtures()
        jobs["jobs"].append(copy.deepcopy(jobs["jobs"][0]))
        with self.assertRaises(ValueError):
            validate_run(run,jobs,SHA)
        run,jobs=fixtures()
        with self.assertRaises(ValueError):
            validate_run(run,jobs,"invalid")


if __name__=="__main__":
    unittest.main()
