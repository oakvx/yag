#!/usr/bin/env python3
"""Validate that release evidence comes from the reviewed opt-in Colibri workflow.

Input files are downloaded from GitHub's authenticated Actions REST API by the
release workflow. This checks metadata and job labels; it is not a hardware
attestation or a substitute for the independent operator security review.
"""
import argparse
import json
from pathlib import Path
import re
import sys

COMMIT_SHA = re.compile(r"[0-9a-f]{40}\Z")
REQUIRED_LABELS = {"self-hosted", "linux", "yag-colibri"}
WORKFLOW_PATH = ".github/workflows/live-model.yml"


def _read_json(path):
    file = Path(path)
    if file.is_symlink() or not file.is_file() or not 0 < file.stat().st_size < 262144:
        raise ValueError("Invalid GitHub Actions metadata input")
    try:
        return json.loads(file.read_text(encoding="utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Malformed GitHub Actions metadata") from exc


def validate_run(run_data, jobs_data, commit, repository="oakvx/yag"):
    if not isinstance(commit, str) or not COMMIT_SHA.fullmatch(commit):
        raise ValueError("Expected an exact lowercase 40-character release commit")
    if not isinstance(run_data, dict) or not isinstance(jobs_data, dict):
        raise ValueError("Unexpected GitHub Actions metadata structure")
    trusted_run = (run_data.get("head_sha") == commit
                   and run_data.get("head_branch") == "main"
                   and run_data.get("event") == "workflow_dispatch"
                   and run_data.get("status") == "completed"
                   and run_data.get("conclusion") == "success"
                   and run_data.get("path") == WORKFLOW_PATH
                   and isinstance(run_data.get("repository"), dict)
                   and run_data["repository"].get("full_name") == repository)
    if not trusted_run:
        raise ValueError("No successful manually dispatched Colibri workflow at this exact release commit")
    jobs = jobs_data.get("jobs")
    if not isinstance(jobs, list) or len(jobs) != 1:
        raise ValueError("Expected exactly one trusted Colibri qualification job")
    job = jobs[0]
    if (not isinstance(job, dict) or job.get("name") != "Real model / real inference backend"
            or job.get("status") != "completed" or job.get("conclusion") != "success"
            or not isinstance(job.get("runner_name"), str) or not job["runner_name"]
            or not isinstance(job.get("labels"), list)
            or not REQUIRED_LABELS.issubset(set(
                label for label in job["labels"] if isinstance(label, str)))):
        raise ValueError("Qualification did not succeed on the labeled Colibri runner")
    steps = job.get("steps")
    if not isinstance(steps, list):
        raise ValueError("Missing qualification step evidence")
    seen = {}
    for step in steps:
        if isinstance(step, dict) and isinstance(step.get("name"), str):
            if step["name"] in seen:
                raise ValueError("Duplicate qualification job step")
            seen[step["name"]] = step.get("conclusion")
    for required_step in (
        "Verify runner setup without printing private configuration",
        "Build isolated gateway on the runner",
        "Qualify actual inference and model protocols",
        "Reject incomplete release-candidate qualification",
    ):
        if seen.get(required_step) != "success":
            raise ValueError("Missing mandatory real-model release qualification step")
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-info", required=True)
    parser.add_argument("--jobs", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--repository", default="oakvx/yag")
    args = parser.parse_args(argv)
    try:
        validate_run(_read_json(args.run_info), _read_json(args.jobs),
                     args.commit, args.repository)
    except (OSError, ValueError) as exc:
        print("STABLE RELEASE BLOCKED:", str(exc), file=sys.stderr)
        return 1
    print("Trusted Colibri Actions run and mandatory qualification steps validated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
