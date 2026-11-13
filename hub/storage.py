"""Persistent control-plane configuration. API tokens are stored as hashes only."""
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import tempfile
import time

NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.-]{0,47}$")
MODEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$")


def digest(secret):
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def valid_name(value):
    return isinstance(value, str) and NAME.fullmatch(value) is not None


def private_node_url(value):
    """Accept literal private IPs; reject DNS rebinding, metadata and WAN targets."""
    from urllib.parse import urlsplit
    if not isinstance(value, str) or len(value) > 256:
        raise ValueError("node URL must be a private HTTPS/HTTP IPv4 address")
    try:
        target = urlsplit(value)
        host = ipaddress.ip_address(target.hostname or "")
        port = target.port
    except (ValueError, TypeError) as exc:
        raise ValueError("node URL must contain a private IPv4 address") from exc
    if (not isinstance(host, ipaddress.IPv4Address)
            or not host.is_private or host.is_loopback or host.is_link_local
            or host.is_multicast or host.is_unspecified or target.username
            or target.password or target.path not in ("", "/v1")
            or target.query or target.fragment or target.scheme not in ("http", "https")
            or port is None or not 1 <= port <= 65535):
        raise ValueError("node URL must be an RFC1918 address: e.g. http://192.168.1.20:11434/v1")
    allowed = (ipaddress.ip_network("10.0.0.0/8"),
               ipaddress.ip_network("172.16.0.0/12"),
               ipaddress.ip_network("192.168.0.0/16"))
    if not any(host in network for network in allowed):
        raise ValueError("node must use a private RFC1918 IPv4 address")
    return value.rstrip("/")


class Storage:
    def __init__(self, filename, legacy_keys="", legacy_scopes=""):
        self.path = str(Path(filename))
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        old_umask = os.umask(0o077)
        try:
            self._initialize(legacy_keys, legacy_scopes)
        finally:
            os.umask(old_umask)

    def db(self):
        conn = sqlite3.connect(self.path, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _initialize(self, keys, scopes):
        with self.db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS clients (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    secret_hash TEXT NOT NULL UNIQUE,
                    scope TEXT NOT NULL DEFAULT 'inference+models',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    priority INTEGER NOT NULL DEFAULT 1,
                    max_parallel INTEGER NOT NULL DEFAULT 2,
                    accepted INTEGER NOT NULL DEFAULT 0,
                    rejected INTEGER NOT NULL DEFAULT 0,
                    created INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS nodes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    url TEXT NOT NULL UNIQUE,
                    models TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_clients_secret ON clients(secret_hash);
            """)
            if db.execute("SELECT 1 FROM meta WHERE name='initialized'").fetchone():
                return
            seed = keys.split(",") if keys else []
            permissions = scopes.split(",") if scopes else ["inference+models"] * len(seed)
            if len(permissions) != len(seed):
                raise ValueError("legacy key scopes do not match client keys")
            for i, (secret, scope) in enumerate(zip(seed, permissions), 1):
                if len(secret) < 16 or scope not in ("all", "inference", "models", "monitor", "inference+models"):
                    raise ValueError("invalid legacy client credentials")
                db.execute("""INSERT INTO clients(name,secret_hash,scope,created)
                              VALUES(?,?,?,?)""",
                           (f"pc-{i:02d}", digest(secret), scope, int(time.time())))
            db.execute("INSERT INTO meta(name,value) VALUES('initialized','1')")

    def authenticate(self, secret):
        if not isinstance(secret, str) or len(secret) > 512:
            return None
        with self.db() as db:
            row = db.execute("""SELECT id,name,scope,enabled,priority,max_parallel
                                FROM clients WHERE secret_hash=?""", (digest(secret),)).fetchone()
            return dict(row) if row and row["enabled"] else None

    def is_enabled(self, identity):
        with self.db() as db:
            return db.execute("SELECT 1 FROM clients WHERE id=? AND enabled=1",
                              (identity,)).fetchone() is not None

    def list_clients(self):
        with self.db() as db:
            return [dict(row) for row in db.execute(
                """SELECT id,name,scope,enabled,priority,max_parallel,accepted,rejected,created
                   FROM clients ORDER BY id""")]

    def create_client(self, name, priority=1, max_parallel=2):
        if not valid_name(name) or not isinstance(priority, int) or priority not in (0, 1, 2) or not isinstance(max_parallel, int) or not 1 <= max_parallel <= 8:
            raise ValueError("invalid client name, priority (0..2) or parallel limit (1..8)")
        secret = secrets.token_urlsafe(32)
        with self.db() as db:
            cursor = db.execute("""INSERT INTO clients(name,secret_hash,priority,max_parallel,created)
                                   VALUES(?,?,?,?,?)""",
                                (name, digest(secret), priority, max_parallel, int(time.time())))
            return {"id": cursor.lastrowid, "name": name, "key": secret,
                    "priority": priority, "max_parallel": max_parallel}

    def update_client(self, identity, changes):
        if not isinstance(changes, dict) or not changes or set(changes) - {"name", "enabled", "priority", "max_parallel"}:
            raise ValueError("invalid client update")
        fields = {}
        if "name" in changes:
            if not valid_name(changes["name"]):
                raise ValueError("invalid client name")
            fields["name"] = changes["name"]
        if "enabled" in changes:
            if not isinstance(changes["enabled"], bool):
                raise ValueError("enabled must be a boolean")
            fields["enabled"] = int(changes["enabled"])
        if "priority" in changes:
            if type(changes["priority"]) is not int or changes["priority"] not in (0, 1, 2):
                raise ValueError("priority must be 0..2")
            fields["priority"] = changes["priority"]
        if "max_parallel" in changes:
            if type(changes["max_parallel"]) is not int or not 1 <= changes["max_parallel"] <= 8:
                raise ValueError("max_parallel must be 1..8")
            fields["max_parallel"] = changes["max_parallel"]
        with self.db() as db:
            statement = "UPDATE clients SET " + ",".join(k + "=?" for k in fields) + " WHERE id=?"
            result = db.execute(statement, [*fields.values(), identity])
            return result.rowcount > 0

    def revoke_client(self, identity):
        with self.db() as db:
            return db.execute("DELETE FROM clients WHERE id=?", (identity,)).rowcount > 0

    def usage(self, identity, allowed):
        with self.db() as db:
            column = "accepted" if allowed else "rejected"
            db.execute("UPDATE clients SET " + column + "=" + column + "+1 WHERE id=?", (identity,))

    def list_nodes(self):
        with self.db() as db:
            return [dict(row) | {"models": json.loads(row["models"])} for row in
                    db.execute("SELECT id,name,url,models,enabled,created FROM nodes ORDER BY id")]

    def add_node(self, name, url, models):
        if not valid_name(name) or not isinstance(models, list) or not models or len(models) > 32:
            raise ValueError("node requires a name and 1..32 model IDs")
        if any(not isinstance(model, str) or not MODEL.fullmatch(model) for model in models):
            raise ValueError("invalid node model ID")
        url = private_node_url(url)
        with self.db() as db:
            if db.execute("SELECT count(*) FROM nodes").fetchone()[0] >= 8:
                raise ValueError("maximum of 8 extra nodes")
            result = db.execute("INSERT INTO nodes(name,url,models,created) VALUES(?,?,?,?)",
                                (name, url, json.dumps(list(dict.fromkeys(models))), int(time.time())))
            return result.lastrowid

    def update_node(self, identity, changes):
        if not isinstance(changes, dict) or not changes or set(changes) - {"name", "enabled", "models"}:
            raise ValueError("invalid node update")
        fields = {}
        if "name" in changes:
            if not valid_name(changes["name"]):
                raise ValueError("invalid node name")
            fields["name"] = changes["name"]
        if "enabled" in changes:
            if not isinstance(changes["enabled"], bool):
                raise ValueError("enabled must be boolean")
            fields["enabled"] = int(changes["enabled"])
        if "models" in changes:
            models = changes["models"]
            if not isinstance(models, list) or not models or len(models) > 32 or any(
                    not isinstance(m, str) or not MODEL.fullmatch(m) for m in models):
                raise ValueError("invalid node model list")
            fields["models"] = json.dumps(list(dict.fromkeys(models)))
        with self.db() as db:
            return db.execute("UPDATE nodes SET " + ",".join(k+"=?" for k in fields) +
                              " WHERE id=?", [*fields.values(), identity]).rowcount > 0

    def delete_node(self, identity):
        with self.db() as db:
            return db.execute("DELETE FROM nodes WHERE id=?", (identity,)).rowcount > 0

    def backup(self):
        """Consistent SQLite snapshot (WAL included), returned only to an admin."""
        with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as target:
            path = target.name
        try:
            with self.db() as source:
                with sqlite3.connect(path) as destination:
                    source.backup(destination)
            data = Path(path).read_bytes()
            if len(data) > 16*1024*1024:
                raise ValueError("backup exceeds 16 MiB; use offline database maintenance")
            return data
        finally:
            Path(path).unlink(missing_ok=True)
