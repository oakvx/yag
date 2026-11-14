#!/usr/bin/env python3
"""Fail-closed, non-secret LAN deployment preflight for YAG.

This checks only observable local configuration. It cannot prove firewall
isolation, live credentials, hardware qualification or private registry state.
"""
import json
import os
from pathlib import Path
import re
import ssl
import stat
from urllib.parse import urlsplit

from lan_ops import read_entries, read_pool, validate_backend

KEY_PATTERN = re.compile(r'YAG_POOL_KEY_[1-8]\Z')
SCOPE_ALLOWED = {'inference', 'models', 'inference+models'}


def check_private_file(path):
    source = Path(path)
    if source.is_symlink() or not source.is_file():
        raise ValueError('Private LAN configuration must be a regular non-symlink file')
    info = source.stat()
    if os.name != 'nt':
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077:
            raise ValueError('Private LAN configuration must be owned by this user and mode 0600')
    return source


def evaluate(config_path, ca_path=None):
    """Return findings with fixed IDs/messages: never echo env keys or secrets."""
    path = check_private_file(config_path)
    _, env = read_entries(path)
    raw = path.read_text(encoding='utf-8')
    findings = []

    def add(code, status, message):
        findings.append({'id':code,'status':status,'message':message})

    seen = set()
    for line in raw.splitlines():
        if not line or line.lstrip().startswith('#') or '=' not in line:
            continue
        name = line.split('=',1)[0].strip()
        if name in seen and (name.startswith('YAG_') or name.startswith('COMPOSE_')):
            add('duplicate_config','block','Duplicate deployment configuration key')
        seen.add(name)

    primary = env.get('YAG_API_KEY','')
    extra = env.get('YAG_EXTRA_API_KEYS','').split(',')
    scopes = env.get('YAG_EXTRA_KEY_SCOPES','').split(',')
    if not primary or len(primary) < 32:
        add('primary_key','block','Administrator API key must be at least 32 characters')
    else:
        add('primary_key','pass','Administrator key is present and has adequate length')
    if (not 1 <= len(extra) <= 16 or len(extra) != len(scopes)
            or any(len(key) < 32 for key in extra)
            or len(set(extra+[primary])) != len(extra)+1):
        add('client_keys','block','Unique per-PC scoped keys of adequate length are required')
    else:
        add('client_keys','pass','Per-PC key uniqueness and length verified')
    if any(scope not in SCOPE_ALLOWED for scope in scopes):
        add('client_scopes','block','Static workstation permissions must exclude admin and cloud access')
    else:
        add('client_scopes','pass','Static workstation permissions are restricted')

    default = env.get('YAG_UPSTREAM_URL','')
    try:
        validate_backend(default)
        if urlsplit(default).scheme == 'https':
            add('default_upstream','block','Cloud HTTPS provider cannot be the unrestricted default backend')
        else:
            add('default_upstream','pass','Default inference backend uses the local/private LAN')
    except (ValueError,AttributeError):
        add('default_upstream','block','Invalid or missing default inference backend')

    if env.get('YAG_FALLBACK_TO_DEFAULT','0') not in ('0',''):
        add('fallback','warn','Operator fallback needs explicit route/egress review')
    if env.get('YAG_ENFORCE_MODEL_CAPABILITIES','0') != '1':
        add('capabilities','warn','Model capability declarations are not enforced')
    if env.get('YAG_RATE_LIMIT_PER_MINUTE','120') in ('0',''):
        add('rate_limit','warn','Rate limiting is disabled')

    # Validate bootstrap pool separately from the runtime-managed provider store.
    try:
        pool = read_pool(path)
    except (ValueError, json.JSONDecodeError):
        add('provider_pool','block','Provider pool configuration is invalid')
        pool = []
    for entry in pool:
        if urlsplit(entry['url']).scheme != 'https':
            continue
        if (entry.get('exclusive_models') is not True or not entry.get('models')
                or not KEY_PATTERN.fullmatch(entry.get('key_env') or '')
                or not env.get(entry['key_env'])):
            add('cloud_scope','block','Cloud backends need dedicated model IDs and a private credential alias')
        if not entry.get('max_requests_per_run',0):
            add('cloud_admission','block','Cloud backend must have a positive per-run request ceiling')
    if not any(entry.get('exclusive_models') for entry in pool):
        add('runtime_pool','warn','Review any runtime-managed provider store on the running gateway')
    else:
        add('provider_pool','pass','Configured dedicated provider routes were inspected')
    if any(entry for entry in pool if urlsplit(entry['url']).scheme == 'https'):
        add('cloud_cost','warn','Request ceilings reset on restart and are not monetary billing limits')
        add('cloud_privacy','warn','Provider-bound prompts and tools leave the trusted LAN')

    cert = Path(ca_path) if ca_path else None
    if cert is None or not cert.is_file() or cert.is_symlink():
        add('trusted_ca','warn','No local public Caddy trust certificate available for live TLS verification')
    else:
        try:
            pem = cert.read_text(encoding='ascii')
            ssl.PEM_cert_to_DER_cert(pem)
            add('trusted_ca','pass','A parseable public Caddy CA certificate is present')
        except (OSError,ValueError):
            add('trusted_ca','block','Cannot parse local public Caddy CA certificate')
    add('firewall','manual','Verify router port forwarding and firewall isolation on Colibri')
    add('hardware','manual','Verify GPU/driver, signed releases and real-model acceptance on Colibri')
    return {'schema_version':1, 'checks':findings,
            'blocked':any(f['status']=='block' for f in findings),
            'manual_review_required':True}


def require_live_tls(config, https_status):
    """Verify the private reverse proxy hides admin routes even for the primary key."""
    checks = (
        ('/health',None,200),
        ('/v1/models',None,401),
        ('/api/admin/clients',config['YAG_API_KEY'],404),
    )
    for path,key,expected in checks:
        if https_status(config,path,key) != expected:
            raise ValueError('Live TLS/admin isolation check failed')
    return True
