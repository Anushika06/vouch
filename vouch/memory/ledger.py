"""Git-backed, hash-chained memory ledger (dulwich, pure Python).

Each memory is `memories/<TYPE>/<id>.json`. Every write, approval, rejection, supersede, expiry or
revert is one commit whose message records the source, trust, model and gate reason.
"""

from __future__ import annotations

import io
import json
import threading
import zipfile
from datetime import UTC, datetime
from pathlib import Path

from dulwich.objects import Blob, Commit, Tree
from dulwich.repo import Repo

from vouch.models import Memory
from vouch.util import iso

AUTHOR = b"Vouch <ledger@vouch.local>"


def mem_path(m: Memory) -> str:
    return f"memories/{m.type.value}/{m.id}.json"


class Ledger:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.lock = threading.RLock()
        if (self.root / ".git").exists():
            self.repo = Repo(str(self.root))
        else:
            self.root.mkdir(parents=True, exist_ok=True)
            self.repo = Repo.init(str(self.root))
            (self.root / "README.md").write_text(
                "# Vouch memory ledger\n\nEach file under memories/ is one memory. Every change is a commit.\n",
                encoding="utf-8")
            self._commit(["README.md"], "init: ledger created", None)

    def _commit(self, paths: list[str], message: str, ts: float | None) -> str:
        wt = self.repo.get_worktree()
        wt.stage(paths)
        sha = wt.commit(message=message.encode("utf-8"), author=AUTHOR, committer=AUTHOR,
                        commit_timestamp=ts, author_timestamp=ts, commit_timezone=0, author_timezone=0)
        return sha.decode()

    def write(self, m: Memory, action: str, actor: str = "vouch", note: str = "", ts: float | None = None) -> str:
        with self.lock:
            path = mem_path(m)
            full = self.root / path
            full.parent.mkdir(parents=True, exist_ok=True)
            full.write_text(m.model_dump_json(indent=2), encoding="utf-8")
            p = m.provenance[0] if m.provenance else None
            g = m.gate_decision
            lines = [
                f"{action}: {m.id} [{m.type.value}/{m.trust.value}/{m.status.value}]",
                "",
                f"content: {m.content[:200]}",
                f"source: {p.kind} {p.ref}" if p else "source: -",
                f"principal: {p.principal}" if p else "principal: -",
                f"trust: {m.trust.value}" + (" (approved by user)" if m.approved_by_user else ""),
                f"model: {m.created_by_model or '-'}",
                f"gate: {g.action.value} — {g.reason}" if g else "gate: -",
                f"flags: {', '.join(g.detector_flags) if g and g.detector_flags else '-'}",
                f"actor: {actor}",
            ]
            if note:
                lines.append(f"note: {note}")
            return self._commit([path], "\n".join(lines), ts)

    # ------------------------------------------------------------------ reading history
    def _head(self) -> bytes | None:
        try:
            return self.repo.head()
        except KeyError:
            return None

    def log(self, limit: int = 200, path: str | None = None) -> list[dict]:
        head = self._head()
        if head is None:
            return []
        walker = self.repo.get_walker(include=[head], paths=[path.encode()] if path else None, max_entries=limit)
        out = []
        for e in walker:
            c: Commit = e.commit
            msg = c.message.decode("utf-8", "replace")
            out.append({"sha": c.id.decode(), "time": iso(datetime.fromtimestamp(c.commit_time, UTC)),
                        "ts": c.commit_time, "title": msg.split("\n", 1)[0], "message": msg})
        return out

    def _blob_at(self, commit_sha: str, path: str) -> bytes | None:
        commit = self.repo[commit_sha.encode()]
        tree: Tree = self.repo[commit.tree]
        obj = tree
        for part in path.split("/"):
            try:
                _mode, sha = obj[part.encode()]
            except KeyError:
                return None
            obj = self.repo[sha]
        return obj.data if isinstance(obj, Blob) else None

    def history(self, m_or_path: Memory | str) -> list[dict]:
        path = mem_path(m_or_path) if isinstance(m_or_path, Memory) else m_or_path
        out = []
        for entry in self.log(limit=500, path=path):
            data = self._blob_at(entry["sha"], path)
            entry["snapshot"] = json.loads(data) if data else None
            out.append(entry)
        return out

    def version(self, sha: str, path: str) -> Memory | None:
        data = self._blob_at(sha, path)
        return Memory.model_validate_json(data) if data else None

    def snapshot(self, sha: str) -> list[Memory]:
        commit = self.repo[sha.encode()]
        out: list[Memory] = []
        for entry in self.repo.object_store.iter_tree_contents(commit.tree):
            p = entry.path.decode()
            if p.startswith("memories/") and p.endswith(".json"):
                out.append(Memory.model_validate_json(self.repo[entry.sha].data))
        return out

    def commit_at_or_before(self, ts: float) -> str | None:
        for e in self.log(limit=5000):
            if e["ts"] <= ts:
                return e["sha"]
        return None

    def export_zip(self) -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for f in self.root.rglob("*"):
                if f.is_file():
                    z.write(f, f.relative_to(self.root).as_posix())
        return buf.getvalue()
