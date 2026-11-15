#!/usr/bin/env python3
"""Review exact main-commit CI/security checks before creating a YAG prerelease.

This validates authenticated GitHub Actions metadata downloaded by an
explicitly dispatched workflow. It does not create tags or publish anything.
"""
import argparse
from datetime import datetime
import json
from pathlib import Path
import re
import sys

SHA = re.compile(r'[0-9a-f]{40}\Z')
RC = re.compile(r'v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)-rc\.[1-9][0-9]*\Z')
WEEKLY = re.compile(r'v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)-weekly\.([0-9]{8})\Z')
REQUIRED = ('CI', 'Security and dependency review')
MAX_BYTES = 2 * 1024 * 1024


def validate(tag, commit, metadata, repository='oakvx/yag', weekly=False):
    if weekly:
        match = WEEKLY.fullmatch(tag) if isinstance(tag, str) else None
        if not match or len(tag) > 64:
            raise ValueError('Weekly tag must match vMAJOR.MINOR.PATCH-weekly.YYYYMMDD')
        try:
            monday = datetime.strptime(match.group(1), '%Y%m%d').date()
        except ValueError as exc:
            raise ValueError('Weekly tag contains an invalid calendar date') from exc
        if monday.weekday() != 0 or monday.strftime('%Y%m%d') != match.group(1):
            raise ValueError('Weekly tag date must be a real Monday in UTC')
    elif not isinstance(tag, str) or not RC.fullmatch(tag) or len(tag) > 64:
        raise ValueError('Tag must be an exact semantic version prerelease such as v0.1.0-rc.1')
    if not isinstance(commit,str) or not SHA.fullmatch(commit):
        raise ValueError('Commit must be a full reviewed lowercase Git SHA-1')
    if not isinstance(metadata,dict) or not isinstance(metadata.get('workflow_runs'),list):
        raise ValueError('Missing GitHub Actions workflow-run metadata')
    runs=metadata['workflow_runs']
    if len(runs)>100:
        raise ValueError('Workflow metadata page exceeded review limit')
    for name in REQUIRED:
        matches=[run for run in runs if isinstance(run,dict)
            and run.get('name')==name
            and run.get('head_sha')==commit
            and run.get('head_branch')=='main'
            and run.get('event')=='push'
            and isinstance(run.get('head_repository'),dict)
            and run['head_repository'].get('full_name')==repository
            and type(run.get('run_number')) is int]
        if not matches:
            raise ValueError('Missing required CI/security run for this exact main commit')
        latest=max(matches,key=lambda run:(run['run_number'],run.get('run_attempt',0)))
        if latest.get('status')!='completed' or latest.get('conclusion')!='success':
            raise ValueError('Latest CI/security run has not completed successfully')
    return True


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag',required=True)
    parser.add_argument('--weekly',action='store_true',help='Allow an exact weekly experimental prerelease tag')
    parser.add_argument('--commit',required=True)
    parser.add_argument('--runs-file',required=True)
    parser.add_argument('--repository',default='oakvx/yag')
    args=parser.parse_args(argv)
    try:
        file=Path(args.runs_file)
        if file.is_symlink() or not file.is_file() or not 0<file.stat().st_size<=MAX_BYTES:
            raise ValueError('Invalid local GitHub Actions metadata file')
        runs=json.loads(file.read_text('utf-8'))
        validate(args.tag,args.commit,runs,args.repository,weekly=args.weekly)
    except (OSError,ValueError,UnicodeError) as exc:
        print('CANDIDATE CREATION BLOCKED:',str(exc),file=sys.stderr)
        return 1
    print('Candidate tag, main commit and latest CI/security runs: reviewed.')
    return 0


if __name__=='__main__':
    sys.exit(main())
