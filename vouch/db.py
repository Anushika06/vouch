"""Per-workspace SQLite: memory index (FTS5 + vectors) and the assistant's app state."""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, type TEXT, status TEXT, trust TEXT, effective_trust TEXT, subject TEXT,
  content TEXT, json TEXT, created_at TEXT, updated_at TEXT, expires_at TEXT);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, content, subject);
CREATE TABLE IF NOT EXISTS embeddings (id TEXT PRIMARY KEY, vec TEXT, model TEXT);
CREATE TABLE IF NOT EXISTS memory_usage (mem_id TEXT, turn_id TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS vault (mem_id TEXT PRIMARY KEY, ciphertext TEXT);

CREATE TABLE IF NOT EXISTS turns (id TEXT PRIMARY KEY, role TEXT, content TEXT, meta TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY, kind TEXT, ref TEXT, principal TEXT, trust TEXT,
  turn_id TEXT, raw TEXT, reader TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS vals (handle TEXT PRIMARY KEY, doc_id TEXT, turn_id TEXT, value TEXT, trust TEXT,
  kind TEXT, source TEXT, created_at TEXT);

CREATE TABLE IF NOT EXISTS emails (id TEXT PRIMARY KEY, from_addr TEXT, from_name TEXT, to_addrs TEXT,
  cc TEXT, subject TEXT, body TEXT, html TEXT, date TEXT, unread INTEGER, labels TEXT, attack TEXT);
CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, to_addrs TEXT, cc TEXT, bcc TEXT, subject TEXT,
  body TEXT, attachments TEXT, sent_at TEXT, turn_id TEXT, origin TEXT);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, title TEXT, start TEXT, end TEXT, attendees TEXT,
  location TEXT, notes TEXT, source TEXT, trust TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT, due TEXT, done INTEGER, source TEXT,
  trust TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, name TEXT, mime TEXT, description TEXT, content TEXT);
CREATE TABLE IF NOT EXISTS pending_actions (id TEXT PRIMARY KEY, turn_id TEXT, tool TEXT, args TEXT,
  taint TEXT, status TEXT, result TEXT, created_at TEXT, resolved_at TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT, model TEXT, task TEXT,
  tokens_in INTEGER, tokens_out INTEGER, cost REAL, latency_ms INTEGER, mock INTEGER, created_at TEXT);
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, kind TEXT, json TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS skills (name TEXT PRIMARY KEY, version TEXT, hash TEXT, manifest TEXT, scan TEXT,
  review TEXT, status TEXT, installed_at TEXT);
CREATE TABLE IF NOT EXISTS skill_runs (id TEXT PRIMARY KEY, name TEXT, input TEXT, output TEXT, log TEXT,
  sandbox TEXT, created_at TEXT);
"""

JSON_COLS = {"meta", "reader", "raw", "value", "to_addrs", "cc", "bcc", "attachments", "attendees", "labels", "args",
             "taint", "result", "json", "manifest", "scan", "review", "log", "attack"}


class DB:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(str(self.path), check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(SCHEMA)

    def x(self, sql: str, params: tuple | list = ()) -> sqlite3.Cursor:
        with self.lock:
            return self.conn.execute(sql, params)

    def rows(self, sql: str, params: tuple | list = ()) -> list[dict[str, Any]]:
        with self.lock:
            return [_decode(dict(r)) for r in self.conn.execute(sql, params).fetchall()]

    def row(self, sql: str, params: tuple | list = ()) -> dict[str, Any] | None:
        r = self.rows(sql, params)
        return r[0] if r else None

    def insert(self, table: str, data: dict[str, Any], replace: bool = True) -> None:
        cols = list(data)
        vals = [json.dumps(v, ensure_ascii=False, default=str) if (k in JSON_COLS and not isinstance(v, str | None))
                else v for k, v in data.items()]
        verb = "INSERT OR REPLACE" if replace else "INSERT"
        self.x(f"{verb} INTO {table} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", vals)

    def get_setting(self, key: str, default: Any = None) -> Any:
        r = self.row("SELECT value FROM settings WHERE key=?", (key,))
        return json.loads(r["value"]) if r and isinstance(r["value"], str) else (r["value"] if r else default)

    def set_setting(self, key: str, value: Any) -> None:
        self.x("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, json.dumps(value)))

    def close(self) -> None:
        with self.lock:
            self.conn.close()


def _decode(d: dict[str, Any]) -> dict[str, Any]:
    for k, v in d.items():
        if k in JSON_COLS and isinstance(v, str) and v[:1] in "[{\"" :
            try:
                d[k] = json.loads(v)
            except json.JSONDecodeError:
                pass
    return d
