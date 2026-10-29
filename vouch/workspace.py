"""A workspace is one user's isolated assistant state: git ledger, SQLite, value store, inbox, calendar."""

from __future__ import annotations

import json
import shutil
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from vouch.config import Settings
from vouch.db import DB
from vouch.gate.gate import GateConfig, TrustGate
from vouch.gate.policy import TrustSettings, trust_for_source
from vouch.llm.router import Budget, LLMResult, Router
from vouch.memory.store import MemoryStore
from vouch.models import GateAction, GateDecision, Memory, MemType, Provenance, Status, Trust
from vouch.reader.reader import QuarantinedReader
from vouch.util import iso, new_id, utcnow
from vouch.web.demo import DemoWeb
from vouch.web.tavily import TavilyCache, Web, WebMeter

SEED_DIR = Path(__file__).resolve().parent / "demo" / "seed"


@dataclass
class AgentConfig:
    """`naive` is the poisoned baseline; the other switches are the eval ablations."""

    naive: bool = False
    gate: bool = True
    reader_split: bool = True
    taint: bool = True
    corroboration_rules: bool = True

    @classmethod
    def named(cls, name: str) -> AgentConfig:
        return {
            "naive": cls(naive=True, gate=False, reader_split=False, taint=False, corroboration_rules=False),
            "vouch-full": cls(),
            "no-gate": cls(gate=False),
            "no-reader-split": cls(reader_split=False),
            "no-taint": cls(taint=False),
            "no-corroboration-rules": cls(corroboration_rules=False),
        }[name]

    def label(self) -> str:
        if self.naive:
            return "naive"
        off = [k for k in ("gate", "reader_split", "taint", "corroboration_rules") if not getattr(self, k)]
        return "vouch-full" if not off else "no-" + "-".join(o.replace("_", "-") for o in off)


@dataclass
class Workspace:
    root: Path
    settings: Settings
    router: Router
    cache: TavilyCache
    cfg: AgentConfig = field(default_factory=AgentConfig)
    clock_offset: timedelta = field(default_factory=timedelta)

    def __post_init__(self):
        self.root = Path(self.root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = DB(self.root / "vouch.db")
        self.budget = Budget(token_cap=self.settings.vouch_session_token_cap if self.settings.hosted else 0,
                             sink=self._record_usage)
        self.store = MemoryStore(self.root, self.db, self.router, self.budget, self.now)
        self.gate = TrustGate(self.store, self.router, self.budget, GateConfig(enabled=self.cfg.gate))
        self.demo_web = DemoWeb()
        self.meter = WebMeter(cap=self.settings.vouch_session_tavily_cap if self.settings.hosted else 0)
        self.web = Web(self.settings, self.cache, self.demo_web, self.meter)
        self.reader = QuarantinedReader(self.router, self.budget)
        off = self.db.get_setting("clock_offset_s")
        if off:
            self.clock_offset = timedelta(seconds=off)

    @property
    def mode(self) -> str:
        return "naive" if self.cfg.naive else "vouch"

    # ------------------------------------------------------------------ clock (simulated days for demos/evals)
    def now(self) -> datetime:
        return utcnow() + self.clock_offset

    def advance(self, days: float) -> None:
        self.clock_offset += timedelta(days=days)
        self.db.set_setting("clock_offset_s", self.clock_offset.total_seconds())

    # ------------------------------------------------------------------ trust
    def trust_settings(self) -> TrustSettings:
        return TrustSettings(
            trusted_contacts={c.lower() for c in self.db.get_setting("trusted_contacts", [])},
            trusted_domains={d.lower() for d in self.db.get_setting("trusted_domains", [])},
            own_accounts={c.lower() for c in self.db.get_setting("own_accounts", [])},
        )

    def source_trust(self, kind: str, principal: str) -> Trust:
        return trust_for_source(kind, principal, self.trust_settings())

    def trust_principal(self, principal: str) -> None:
        kind, _, who = principal.partition(":")
        if kind in ("contact", "sender"):
            cur = self.db.get_setting("trusted_contacts", [])
            if who.lower() not in cur:
                self.db.set_setting("trusted_contacts", cur + [who.lower()])
        elif kind == "domain":
            cur = self.db.get_setting("trusted_domains", [])
            if who.lower() not in cur:
                self.db.set_setting("trusted_domains", cur + [who.lower()])

    def _record_usage(self, r: LLMResult) -> None:
        self.db.insert("usage", {"role": r.role, "model": r.model, "task": r.task, "tokens_in": r.tokens_in,
                                 "tokens_out": r.tokens_out, "cost": r.cost, "latency_ms": r.latency_ms,
                                 "mock": int(r.mock), "created_at": iso(self.now())}, replace=False)

    def usage_summary(self) -> dict:
        rows = self.db.rows("SELECT role, model, COUNT(*) AS calls, SUM(tokens_in) AS tin, SUM(tokens_out) AS tout, "
                            "SUM(cost) AS cost, AVG(latency_ms) AS avg_ms FROM usage GROUP BY role, model")
        return {"by_role": rows, "total_cost": round(sum(r["cost"] or 0 for r in rows), 6),
                "total_tokens": sum((r["tin"] or 0) + (r["tout"] or 0) for r in rows),
                "tavily_calls": self.meter.calls, "tavily_cache_hits": self.meter.cache_hits,
                "token_cap": self.budget.token_cap, "tavily_cap": self.meter.cap}

    # ------------------------------------------------------------------ seeding
    def is_seeded(self) -> bool:
        return bool(self.db.get_setting("seeded"))

    def seed(self, persona: str = "asha", include_attacks: bool = True) -> None:
        data = json.loads((SEED_DIR / f"{persona}.json").read_text(encoding="utf-8"))
        db = self.db
        db.set_setting("persona", data["persona"])
        db.set_setting("trusted_contacts", data["trusted_contacts"])
        db.set_setting("trusted_domains", data["trusted_domains"])
        db.set_setting("own_accounts", data["own_accounts"])
        db.set_setting("followed_topics", data["followed_topics"])
        now = self.now()
        for m in data["memories"]:
            mem = Memory(type=MemType(m["type"]), content=m["content"], subject=m.get("subject"), status=Status.active,
                         trust=Trust.GREEN, provenance=[Provenance(kind="user_chat", ref="onboarding", principal="user",
                                                                   trust=Trust.GREEN, excerpt=m["content"])],
                         gate_decision=GateDecision(action=GateAction.auto_save, reason="You said it directly (onboarding)",
                                                    classified_type=MemType(m["type"])),
                         created_at=iso(now - timedelta(days=30)))
            self.store.save(mem, "seed", "user", note="demo persona onboarding")
        for e in data["emails"]:
            if e.get("attack") and not include_attacks:
                continue
            body = e["body"].replace("{date+6}", (now + timedelta(days=6)).strftime("%d %b %Y"))
            db.insert("emails", {"id": e["id"], "from_addr": e["from"], "from_name": e["name"],
                                 "to_addrs": [data["persona"]["email"]], "cc": [], "subject": e["subject"], "body": body,
                                 "html": None, "date": iso(now - timedelta(days=e["days_ago"], hours=2)), "unread": 1,
                                 "labels": [], "attack": e.get("attack")})
        base = now.replace(hour=0, minute=0, second=0, microsecond=0)
        for ev in data["events"]:
            day = base + timedelta(days=ev["day"])
            h1, m1 = map(int, ev["start"].split(":"))
            h2, m2 = map(int, ev["end"].split(":"))
            db.insert("events", {"id": new_id("evt"), "title": ev["title"],
                                 "start": iso(day.replace(hour=h1, minute=m1)), "end": iso(day.replace(hour=h2, minute=m2)),
                                 "attendees": ev["attendees"], "location": "", "notes": "", "source": "user",
                                 "trust": "GREEN", "created_at": iso(now)})
        for t in data["tasks"]:
            db.insert("tasks", {"id": new_id("tsk"), "title": t["title"], "due": iso(base + timedelta(days=t["due_day"])),
                                "done": 0, "source": "user", "trust": "GREEN", "created_at": iso(now)})
        for f in data["files"]:
            db.insert("files", {**f, "content": f["description"]})
        db.set_setting("seeded", True)

    def close(self) -> None:
        self.db.close()

    def destroy(self) -> None:
        self.close()
        shutil.rmtree(self.root, ignore_errors=True)
