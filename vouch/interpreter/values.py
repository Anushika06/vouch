"""Value store with opaque handles (CaMeL-style).

Extracted values are variables like `$d3.price` or `$d3.summary`. Safe-typed values (numbers, dates,
enums, domains, addresses) are shown to the planner inline; free text is shown only as a handle plus
its trust label. The interpreter resolves handles at execution time and the renderer at answer time.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from vouch.db import DB
from vouch.models import Trust
from vouch.reader.reader import ReaderOutput
from vouch.util import iso

HANDLE_RE = re.compile(r"\$d\d+(?:\.[a-z_]+(?:\.\d+)?)?")
MEM_RE = re.compile(r"@mem_[0-9A-Z]{26}")
BRACED_RE = re.compile(r"\{\{\s*(\$d\d+(?:\.[a-z_]+(?:\.\d+)?)?|@mem_[0-9A-Z]{26})\s*\}\}")


@dataclass
class Value:
    handle: str
    value: Any
    trust: Trust
    kind: str  # safe | text
    source: str  # principal
    ref: str  # url / email id
    doc_id: str

    def as_dict(self) -> dict:
        return {"handle": self.handle, "value": self.value, "trust": self.trust.value, "kind": self.kind,
                "source": self.source, "ref": self.ref}


class ValueStore:
    def __init__(self, db: DB, clock):
        self.db = db
        self.clock = clock
        self._cache: dict[str, Value] = {}

    def next_doc_handle(self) -> str:
        r = self.db.row("SELECT COUNT(DISTINCT doc_id) AS n FROM vals")
        n = (r["n"] if r else 0) + 1
        while self.get(f"$d{n}") is not None:
            n += 1
        return f"$d{n}"

    def put(self, v: Value, turn_id: str) -> None:
        self._cache[v.handle] = v
        self.db.insert("vals", {"handle": v.handle, "doc_id": v.doc_id, "turn_id": turn_id, "value": {"v": v.value},
                                "trust": v.trust.value, "kind": v.kind, "source": f"{v.source}|{v.ref}",
                                "created_at": iso(self.clock())})

    def get(self, handle: str) -> Value | None:
        if handle in self._cache:
            return self._cache[handle]
        r = self.db.row("SELECT * FROM vals WHERE handle=?", (handle,))
        if not r:
            return None
        src, _, ref = (r["source"] or "|").partition("|")
        val = r["value"]["v"] if isinstance(r["value"], dict) else r["value"]
        v = Value(r["handle"], val, Trust(r["trust"]), r["kind"], src, ref, r["doc_id"])
        self._cache[handle] = v
        return v

    def register(self, ro: ReaderOutput, turn_id: str, raw_fields: bool = False) -> dict:
        """Store a reader output; return the planner's view of it (handles for free text)."""
        h = self.next_doc_handle()
        t, src, ref = ro.trust, ro.principal, ro.ref

        def put(field: str, value: Any, kind: str) -> str:
            hh = f"{h}.{field}"
            self.put(Value(hh, value, t, kind, src, ref, h), turn_id)
            return hh

        put("_doc", ro.doc_id, "safe")
        view: dict[str, Any] = {"handle": h, "kind": ro.kind, "trust": t.value, "source": src}
        view["url"] = put("url", ref, "text") if ref.startswith("http") else ref
        if ro.domain:
            view["domain"] = ro.domain
        if ro.title:
            view["title"] = put("title", ro.title, "text")
        view["summary"] = put("summary", ro.summary, "text")
        for f in ("price", "currency", "date", "sender"):
            val = getattr(ro, f)
            if val is not None:
                put(f, val, "safe")
                view[f] = val
        if ro.amounts:
            view["amounts"] = ro.amounts
        view["claims"] = [put(f"claims.{i}", c.text, "text") for i, c in enumerate(ro.claims)]
        if ro.instructions:
            view["instructions_detected"] = len(ro.instructions)
        if ro.flags:
            view["flags"] = ro.flags
        if raw_fields:  # no-reader-split ablation / naive: the planner sees the raw text
            view["raw_text"] = ro.visible_text[:6000]
            if ro.hidden:
                view["raw_text"] += "\n" + "\n".join(x["text"] for x in ro.hidden)
            view.pop("summary")
            view["summary_text"] = ro.summary
        return view

    def lookup(self, key: str, mem_lookup=None) -> Value | None:
        if key.startswith("@mem_"):
            return mem_lookup(key[1:]) if mem_lookup else None
        return self.get(key)

    def resolve(self, obj: Any, mem_lookup=None) -> tuple[Any, list[Value]]:
        """Replace handles (and @mem refs) inside strings/lists/dicts with their values.
        Returns the values touched, so callers can propagate their trust."""
        used: list[Value] = []

        def sub(s: str) -> Any:
            whole = s.strip()
            m = BRACED_RE.fullmatch(whole) or HANDLE_RE.fullmatch(whole) or MEM_RE.fullmatch(whole)
            if m:
                key = m.group(1) if m.re is BRACED_RE else m.group(0)
                v = self.lookup(key, mem_lookup)
                if v is not None:
                    used.append(v)
                    return v.value

            def rep(mm: re.Match) -> str:
                key = mm.group(1) if mm.re is BRACED_RE else mm.group(0)
                v = self.lookup(key, mem_lookup)
                if v is None:
                    return mm.group(0)
                used.append(v)
                return str(v.value)

            out = BRACED_RE.sub(rep, s)
            out = HANDLE_RE.sub(rep, out)
            return MEM_RE.sub(rep, out)

        def walk(o: Any) -> Any:
            if isinstance(o, str):
                return sub(o)
            if isinstance(o, list):
                return [walk(x) for x in o]
            if isinstance(o, dict):
                return {k: walk(v) for k, v in o.items()}
            return o

        return walk(obj), used

    def render(self, template: str, mem_lookup=None) -> list[dict]:
        """Fill handles into the final answer; each untrusted segment keeps its trust label and source."""
        segs: list[dict] = []
        pat = re.compile(rf"{BRACED_RE.pattern}|({HANDLE_RE.pattern})|({MEM_RE.pattern})")
        pos = 0
        for m in pat.finditer(template):
            key = m.group(1) or m.group(2) or m.group(3)
            v = self.lookup(key, mem_lookup)
            if v is None:
                continue
            if m.start() > pos:
                segs.append({"text": template[pos:m.start()], "trust": None})
            segs.append({"text": str(v.value), "trust": v.trust.value, "source": v.source, "ref": v.ref,
                         "handle": key})
            pos = m.end()
        if pos < len(template):
            segs.append({"text": template[pos:], "trust": None})
        return [s for s in segs if s["text"]]
