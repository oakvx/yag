#!/usr/bin/env python3
"""Host-only, age-encrypted BYOK alias vault for the NATIVE POSIX YAG binary.

Keys are accepted only via hidden terminal input, encrypted at rest with age,
and passed to the native Host process via inherited environment at execve.
This DOES NOT encrypt process memory, /proc visibility or Docker metadata.
No browser, HTTP endpoint or credential logging is involved.
"""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile

ALIAS = re.compile(r'YAG_POOL_KEY_[1-8]\Z')
RECIPIENT = re.compile(r'age1[0-9a-z]{20,100}\Z')
KEY = re.compile(r'[A-Za-z0-9_.:+/=-]{8,4096}\Z')
MAX_BYTES = 65536


def _check_posix():
    if os.name != 'posix':
        raise ValueError('Encrypted native BYOK vault requires POSIX owner/mode permissions')


def _private_file(path):
    _check_posix()
    path = Path(path)
    if not path.is_absolute() or path.is_symlink():
        raise ValueError('Private file must have an absolute non-symlink path')
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
            or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) & 0o077
            or not 0 < info.st_size <= MAX_BYTES):
        raise ValueError('Private file must be regular, owner-only and reasonably sized')
    return path


def _private_parent(path):
    _check_posix()
    path = Path(path)
    if not path.is_absolute() or path.parent.is_symlink():
        raise ValueError('Vault needs an absolute path inside a non-symlink private folder')
    info = path.parent.stat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid()
            or stat.S_IMODE(info.st_mode) & 0o077):
        raise ValueError('Vault directory must be owned by the current user and mode 0700')
    return path


def _aliases(data):
    if not isinstance(data, dict) or set(data) != {'schema_version','keys'}:
        raise ValueError('Unexpected vault schema')
    if type(data['schema_version']) is not int or data['schema_version'] != 1:
        raise ValueError('Unsupported vault schema')
    keys = data['keys']
    if not isinstance(keys, dict) or len(keys) > 8:
        raise ValueError('Vault must hold at most eight provider aliases')
    for name, value in keys.items():
        if not isinstance(name, str) or not ALIAS.fullmatch(name) or (
                not isinstance(value, str) or not KEY.fullmatch(value)):
            raise ValueError('Invalid provider alias or secret format')
    return keys


def _run_age(args, data):
    if shutil.which('age') is None:
        raise ValueError('Install the age CLI for encrypted provider credentials')
    try:
        response = subprocess.run(['age', *args], input=data, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, timeout=20, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ValueError('age encryption/decryption failed or timed out') from exc
    if response.returncode != 0 or len(response.stdout) > MAX_BYTES:
        raise ValueError('age could not read or write this credential vault')
    return response.stdout


def _read(path, identity):
    file = _private_file(path)
    _private_file(identity)
    plaintext = _run_age(['--decrypt','-i',str(identity)],file.read_bytes())
    try:
        obj = json.loads(plaintext)
    except (ValueError, UnicodeError) as exc:
        raise ValueError('Decrypted vault is not valid JSON') from exc
    return dict(_aliases(obj))


def _encrypt(keys, recipient):
    if not RECIPIENT.fullmatch(recipient):
        raise ValueError('Expected a valid age recipient public key')
    _aliases({'schema_version':1,'keys':keys})
    raw = json.dumps({'schema_version':1,'keys':keys},separators=(',',':')).encode('utf-8')
    if len(raw) > MAX_BYTES:
        raise ValueError('Too many credentials in vault')
    return _run_age(['--encrypt','-r',recipient],raw)


def _write_new(path, content):
    path = _private_parent(path)
    fd = os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:
        with os.fdopen(fd,'wb') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def _replace(path, content):
    path = _private_parent(path)
    _private_file(path)
    fd, name = tempfile.mkstemp(prefix='.yag-vault-',dir=path.parent)
    temp = Path(name)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,'wb') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp,path)
        parent_fd = os.open(path.parent,os.O_RDONLY)
        try: os.fsync(parent_fd)
        finally: os.close(parent_fd)
    finally:
        temp.unlink(missing_ok=True)


def _host_path(raw):
    path = Path(raw)
    if (not path.is_absolute() or path.name != 'yag'
            or path.is_symlink() or not path.is_file() or not os.access(path,os.X_OK)):
        raise ValueError('Only an absolute, executable native yag binary is supported')
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) & 0o022:
        raise ValueError('Native Host binary must not be writable by group or other users')
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='operation',required=True)
    for operation in ('init','list','set','clear','rotate','exec'):
        command = sub.add_parser(operation)
        command.add_argument('--vault',type=Path,required=True)
        if operation != 'init':
            command.add_argument('--identity',type=Path,required=True)
        if operation in ('init','set','clear'):
            command.add_argument('--recipient',required=True)
        if operation in ('set','clear'):
            command.add_argument('--alias',required=True)
        if operation == 'rotate':
            command.add_argument('--new-recipient',required=True)
        if operation == 'exec':
            command.add_argument('--host',required=True)
    args = parser.parse_args(argv)
    try:
        if args.operation == 'init':
            _write_new(args.vault,_encrypt({},args.recipient))
            print('Encrypted BYOK alias vault initialized.')
        elif args.operation == 'list':
            keys = _read(args.vault,args.identity)
            print('Configured provider aliases: '+(', '.join(sorted(keys)) or '(none)'))
        elif args.operation in ('set','clear','rotate'):
            keys = _read(args.vault,args.identity)
            if args.operation in ('set','clear'):
                if not ALIAS.fullmatch(args.alias):
                    raise ValueError('Allowed aliases: YAG_POOL_KEY_1 through YAG_POOL_KEY_8')
                if args.operation == 'set':
                    key = getpass.getpass('Provider key (hidden): ')
                    if not KEY.fullmatch(key):
                        raise ValueError('Provider key must have 8..4096 safe ASCII characters')
                    keys[args.alias] = key
                else:
                    if args.alias not in keys:
                        raise ValueError('Provider alias not present')
                    del keys[args.alias]
                recipient = args.recipient
            else:
                recipient = args.new_recipient
            _replace(args.vault,_encrypt(keys,recipient))
            print('Encrypted vault updated. Restart native YAG to use rotated aliases.')
        else:
            keys = _read(args.vault,args.identity)
            path = _host_path(args.host)
            environment = os.environ.copy()
            # No stale plaintext alias from an unrelated host environment.
            for i in range(1,9):
                environment.pop('YAG_POOL_KEY_'+str(i),None)
            environment.update(keys)
            os.execve(str(path),[str(path)],environment)
    except (OSError, ValueError) as exc:
        # Avoid printing age stderr, filenames, credentials or provider URLs.
        print('BYOK vault error:',str(exc) if isinstance(exc,ValueError)
              else 'Cannot access the private vault or native Host',file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
