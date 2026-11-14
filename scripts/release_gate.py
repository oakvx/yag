#!/usr/bin/env python3
"""Fail-closed review of real Colibri model qualification evidence.

This tool validates *self-reported* evidence from the trusted opt-in runner.
It is not a signature check and does not substitute for verifying the run's
GitHub provenance, hardware inventory, network isolation or human approval.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import sys

PROTOCOLS = frozenset(('chat/completions', 'responses', 'messages'))
SHA40 = re.compile(r'[0-9a-fA-F]{40}\Z')
SHA64 = re.compile(r'[0-9a-fA-F]{64}\Z')
MAX_REPORT_BYTES = 16 * 1024


def evaluate(path, expected_commit, now=None, max_age_days=30, require_gpu=True):
    if not SHA40.fullmatch(expected_commit):
        raise ValueError('Expected an exact 40-character gateway commit SHA')
    if not isinstance(max_age_days, int) or not 1 <= max_age_days <= 30:
        raise ValueError('Evidence expiration must be between 1 and 30 days')
    file = Path(path)
    if file.is_symlink() or not file.is_file():
        raise ValueError('Qualification evidence must be a regular, non-symlink file')
    if not 0 < file.stat().st_size <= MAX_REPORT_BYTES:
        raise ValueError('Qualification evidence exceeds the safe size limit')
    try:
        data = json.loads(file.read_text('utf-8'))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError('Invalid qualification JSON') from exc
    if not isinstance(data, dict) or data.get('schema_version') != 2:
        raise ValueError('Unsupported or obsolete qualification evidence schema')
    if data.get('source') != 'real_upstream_gateway_probe':
        raise ValueError('Not a real-upstream qualification report')
    if data.get('gateway_commit', '').lower() != expected_commit.lower():
        raise ValueError('Qualification was not generated for this exact commit')
    if not isinstance(data.get('model_id_sha256'), str) or not SHA64.fullmatch(data['model_id_sha256']):
        raise ValueError('Missing model identifier fingerprint')
    if data.get('scope') != 'exact_model_runtime_configuration':
        raise ValueError('Unexpected qualification evidence scope')
    if data.get('qualified') is not True:
        raise ValueError('The real-model probe did not pass')
    if data.get('protocol_selection') != 'all':
        raise ValueError('All three gateway protocols must be tested')
    if data.get('stream_requested') is not True or data.get('tool_replay_requested') is not True:
        raise ValueError('Streaming and actual function-tool replay must be exercised')
    results = data.get('results')
    if not isinstance(results, list) or len(results) != len(PROTOCOLS):
        raise ValueError('Expected exactly three protocol results')
    seen = set()
    for item in results:
        if not isinstance(item, dict) or item.get('protocol') not in PROTOCOLS:
            raise ValueError('Unknown protocol in qualification results')
        if item['protocol'] in seen:
            raise ValueError('Duplicate protocol result')
        seen.add(item['protocol'])
        if item.get('text_and_tool_replay') != 'passed' or item.get('stream') != 'passed':
            raise ValueError('A protocol or streaming qualification failed')
    if seen != PROTOCOLS:
        raise ValueError('One or more mandatory protocols were not verified')

    stamp = data.get('measured_at_utc')
    if not isinstance(stamp, str) or len(stamp) > 40:
        raise ValueError('Missing UTC qualification timestamp')
    try:
        recorded = datetime.datetime.fromisoformat(stamp)
    except ValueError as exc:
        raise ValueError('Malformed qualification timestamp') from exc
    if recorded.tzinfo is None or recorded.utcoffset() != datetime.timedelta(0):
        raise ValueError('Qualification timestamp must carry an explicit UTC offset')
    now = now or datetime.datetime.now(datetime.timezone.utc)
    delta = now - recorded
    if delta < datetime.timedelta(minutes=-5) or delta > datetime.timedelta(days=max_age_days):
        raise ValueError('Qualification evidence is stale or from the future')

    runtime = data.get('runtime')
    if not isinstance(runtime, dict) or runtime.get('os') != 'linux':
        raise ValueError('Colibri qualification requires a Linux runtime')
    if not isinstance(runtime.get('architecture'), str) or not runtime['architecture']:
        raise ValueError('Missing hardware architecture')
    gpu = runtime.get('gpu')
    if require_gpu:
        if not isinstance(gpu, dict) or gpu.get('source') != 'nvidia-smi':
            raise ValueError('Missing measured NVIDIA driver/VRAM evidence')
        if (not isinstance(gpu.get('name'), str) or not gpu['name']
                or not isinstance(gpu.get('driver_version'), str)
                or not re.fullmatch(r'[0-9]+(?:\.[0-9]+)*', gpu['driver_version'])
                or type(gpu.get('memory_total_mib')) is not int
                or gpu['memory_total_mib'] <= 0):
            raise ValueError('Invalid measured GPU information')
    return {
        'commit': expected_commit.lower(),
        'model_id_sha256': data['model_id_sha256'].lower(),
        'measured_at_utc': stamp,
        'protocol_count': len(seen),
        'gpu_evidence_present': isinstance(gpu, dict),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', required=True, help='Metadata-only JSON emitted by the real-provider probe')
    parser.add_argument('--commit', required=True, help='Exact, reviewed, full Git commit SHA')
    parser.add_argument('--max-age-days', type=int, default=30)
    parser.add_argument('--allow-no-gpu', action='store_true',
                        help='For CPU-only development; do not use to qualify Colibri GPU release')
    args = parser.parse_args(argv)
    try:
        result = evaluate(args.evidence, args.commit, max_age_days=args.max_age_days,
                          require_gpu=not args.allow_no_gpu)
    except (OSError, ValueError) as exc:
        # Only fixed messages; never print model names, host addresses or secrets.
        print('RELEASE QUALIFICATION BLOCKED:', str(exc), file=sys.stderr)
        return 1
    print('Release qualification evidence: structurally valid and fresh.')
    print('Gateway commit:', result['commit'])
    print('Model ID SHA-256:', result['model_id_sha256'])
    print('Tested protocols:', result['protocol_count'])
    print('Measured GPU inventory included:', result['gpu_evidence_present'])
    print('Verify trusted workflow identity, operator consent and hardware separately.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
