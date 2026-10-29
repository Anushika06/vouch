"""Memory store: git ledger as the source of truth, SQLite (FTS5 + embeddings) for fast recall."""

from __future__ import annotations

import json
import math
import re
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

from cryptography.fernet import Fernet

from vouch.db import DB
from vouch.llm.router import Budget, Router
from vouch.memory.ledger import Ledger, mem_path
from vouch.models import RECALLABLE, Memory, MemType, Status, Trust
from vouch.util import content_words, iso, parse_iso


def mask_secret(text: str) -> str:
    """Mask account-like tokens (6+ chars containing a digit), keeping the last four."""
    def m(match: re.Match) -> str:
        tok = match.group(0)
        return "•" * (len(tok) - 4) + tok[-4:] if len(tok) >= 6 else tok

    return re.sub(r"\b[A-Za-z0-9]*\d[A-Za-z0-9]*\b", m, text)


class MemoryStore:
    def __init__(self, root: Path, db: DB, router: Router | None, budget: Budget | None,
                 clock: Callable[[], datetime]):
        self.ledger = Ledger(root / "ledger")
        self.db = db
        self.router = router
        self.budget = budget
        self.clock = clock
        key_file = root / "vault.key"
        if not key_file.exists():
            key_file.write_bytes(Fernet.generate_key())
        self._fernet = Fernet(key_file.read_bytes())

    # ------------------------------------------------------------------ writes
    def save(self, m: Memory, action: str, actor: str = "vouch", note: str = "") -> str:
        now = self.clock()
        m.updated_at = iso(now)
        sha = self.ledger.write(m, action, actor, note, ts=now.timestamp())
        self._index(m)
        return sha

    def _index(self, m: Memory, embed: bool = True) -> None:
        self.db.insert("memories", {
            "id": m.id, "type": m.type.value, "status": m.status.value, "trust": m.trust.value,
            "effective_trust": m.effective_trust.value, "subject": m.subject, "content": m.content,
            "json": m.model_dump_json(), "created_at": m.created_at, "updated_at": m.updated_at,
            "expires_at": m.expires_at})
        self.db.x("DELETE FROM memories_fts WHERE id=?", (m.id,))
        self.db.x("INSERT INTO memories_fts (id, content, subject) VALUES (?, ?, ?)", (m.id, m.content, m.subject or ""))
        if embed and self.router and not self.db.row("SELECT id FROM embeddings WHERE id=?", (m.id,)):
            vecs = self.router.embed([m.content], self.budget)
            if vecs:
                self.db.insert("embeddings", {"id": m.id, "vec": json.dumps(vecs[0]), "model": self.router.models.get("embed")})

    def vault_put(self, m: Memory, plaintext: str) -> None:
        self.db.insert("vault", {"mem_id": m.id, "ciphertext": self._fernet.encrypt(plaintext.encode()).decode()})
        m.vaulted = True
        m.content = mask_secret(plaintext)

    def vault_get(self, mem_id: str) -> str | None:
        r = self.db.row("SELECT ciphertext FROM vault WHERE mem_id=?", (mem_id,))
        return self._fernet.decrypt(r["ciphertext"].encode()).decode() if r else None

    # ------------------------------------------------------------------ reads
    def get(self, mem_id: str) -> Memory | None:
        r = self.db.row("SELECT json FROM memories WHERE id=?", (mem_id,))
        if not r:
            return None
        m = Memory.model_validate_json(r["json"] if isinstance(r["json"], str) else json.dumps(r["json"]))
        m.used_in = [u["turn_id"] for u in self.db.rows(
            "SELECT turn_id FROM memory_usage WHERE mem_id=? ORDER BY created_at DESC LIMIT 50", (mem_id,))]
        return m

    def all(self, statuses: set[Status] | None = None) -> list[Memory]:
        rows = self.db.rows("SELECT json FROM memories ORDER BY created_at")
        out = [Memory.model_validate_json(_s(r["json"])) for r in rows]
        return [m for m in out if statuses is None or m.status in statuses]

    def list(self, type: str | None = None, trust: str | None = None, status: str | None = None,
             q: str | None = None, limit: int = 500) -> list[Memory]:
        sql, params = "SELECT json FROM memories WHERE 1=1", []
        for col, val in (("type", type), ("trust", trust), ("status", status)):
            if val:
                sql += f" AND {col}=?"
                params.append(val)
        if q:
            sql += " AND (content LIKE ? OR subject LIKE ?)"
            params += [f"%{q}%", f"%{q}%"]
        sql += " ORDER BY updated_at DESC LIMIT ?"
        params.append(limit)
        return [Memory.model_validate_json(_s(r["json"])) for r in self.db.rows(sql, params)]

    def by_subject(self, subject: str, statuses: set[Status] = frozenset({Status.active})) -> list[Memory]:
        rows = self.db.rows("SELECT json FROM memories WHERE subject=?", (subject,))
        return [m for m in (Memory.model_validate_json(_s(r["json"])) for r in rows) if m.status in statuses]

    def recall(self, query: str, k: int = 8, statuses: set[Status] = RECALLABLE) -> list[tuple[Memory, float]]:
        words = list(content_words(query))[:24]
        scores: dict[str, float] = {}
        if words:
            fts_q = " OR ".join(f'"{w}"' for w in words)
            try:
                rows = self.db.rows("SELECT id, bm25(memories_fts) AS s FROM memories_fts WHERE memories_fts MATCH ? "
                                    "ORDER BY s LIMIT 50", (fts_q,))
            except Exception:
                rows = []
            for i, r in enumerate(rows):
                scores[r["id"]] = scores.get(r["id"], 0) + 1.0 / (1 + i)
        if self.router:
            qv = self.router.embed([query], self.budget) if self.db.row("SELECT 1 AS x FROM embeddings LIMIT 1") else None
            if qv:
                for r in self.db.rows("SELECT id, vec FROM embeddings"):
                    sim = _cos(qv[0], json.loads(r["vec"]) if isinstance(r["vec"], str) else r["vec"])
                    if sim > 0.25:
                        scores[r["id"]] = scores.get(r["id"], 0) + sim
        out = []
        for mid, sc in sorted(scores.items(), key=lambda kv: -kv[1]):
            m = self.get(mid)
            if m and m.status in statuses:
                out.append((m, round(sc, 4)))
            if len(out) >= k:
                break
        return out

    def standing_rules(self, require_trusted: bool) -> list[Memory]:
        rules = [m for m in self.list(type=MemType.INSTRUCTION.value, status=Status.active.value)]
        return [m for m in rules if not require_trusted or m.effective_trust == Trust.GREEN]

    def contacts(self, require_trusted: bool) -> list[Memory]:
        cs = [m for m in self.list(type=MemType.CONTACT.value, status=Status.active.value)]
        return [m for m in cs if not require_trusted or m.effective_trust == Trust.GREEN]

    def mark_used(self, mem_ids: list[str], turn_id: str) -> None:
        for mid in dict.fromkeys(mem_ids):
            self.db.x("INSERT INTO memory_usage (mem_id, turn_id, created_at) VALUES (?, ?, ?)",
                      (mid, turn_id, iso(self.clock())))

    def used_by_turn(self, turn_id: str) -> list[str]:
        return [r["mem_id"] for r in self.db.rows("SELECT DISTINCT mem_id FROM memory_usage WHERE turn_id=?", (turn_id,))]

    # ------------------------------------------------------------------ history / time travel
    def history(self, mem_id: str) -> list[dict]:
        m = self.get(mem_id)
        return self.ledger.history(m) if m else []

    def revert(self, mem_id: str, sha: str, actor: str = "user") -> Memory | None:
        m = self.get(mem_id)
        if not m:
            return None
        old = self.ledger.version(sha, mem_path(m))
        if not old:
            return None
        old.updated_at = iso(self.clock())
        self.save(old, "revert", actor, note=f"restored version {sha[:10]}")
        return old

    def snapshot(self, at: str) -> tuple[str | None, list[Memory]]:
        sha = at if re.fullmatch(r"[0-9a-f]{40}", at) else self.ledger.commit_at_or_before(parse_iso(at).timestamp())
        return (sha, self.ledger.snapshot(sha)) if sha else (None, [])

    def rollback(self, sha: str, actor: str = "user") -> int:
        """Restore every memory to its state at `sha`. Memories created after it are marked superseded."""
        then = {m.id: m for m in self.ledger.snapshot(sha)}
        changed = 0
        for cur in self.all():
            old = then.get(cur.id)
            if old is None:
                if cur.status != Status.superseded:
                    cur.status = Status.superseded
                    self.save(cur, "rollback", actor, note=f"did not exist at {sha[:10]}")
                    changed += 1
            elif old.model_dump_json(exclude={"updated_at", "used_in"}) != cur.model_dump_json(exclude={"updated_at", "used_in"}):
                self.save(old, "rollback", actor, note=f"restored to {sha[:10]}")
                changed += 1
        return changed

    def expire_stale(self) -> list[Memory]:
        now = self.clock()
        out = []
        for m in self.all({Status.claim, Status.corroborated_claim}):
            if m.expires_at and parse_iso(m.expires_at) <= now:
                m.status = Status.expired
                self.save(m, "expire", "scheduler", note="claim TTL elapsed without reconfirmation")
                out.append(m)
        return out

    def wipe(self) -> None:
        for t in ("memories", "memories_fts", "embeddings", "memory_usage", "vault"):
            self.db.x(f"DELETE FROM {t}")


def _s(v) -> str:
    return v if isinstance(v, str) else json.dumps(v)


def _cos(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0
