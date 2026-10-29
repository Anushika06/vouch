"""Trust Gate: grounds each memory candidate in its sources, classifies it, applies the policy matrix,
enforces no-downward-overwrite, and writes the result to the ledger."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import timedelta

from vouch.gate.classifier import classify
from vouch.gate.policy import CLAIM_TTL_DAYS, HIGH_RISK_TYPES, reason_for
from vouch.memory.store import MemoryStore
from vouch.models import (
    RECALLABLE,
    TRUST_RANK,
    Candidate,
    GateAction,
    GateDecision,
    MemType,
    Memory,
    Provenance,
    Span,
    Status,
    Trust,
    min_trust,
)
from vouch.reader.detector import flags_for
from vouch.util import content_words, extract_entities, iso, normalize_for_match, truncate

_SELF = {"user", "users", "asha", "she", "her", "the"}
_ROLE = re.compile(r"\b(accountant|lawyer|doctor|dentist|landlord|manager|boss|sister|brother|mother|father|mom|dad|"
                   r"wife|husband|partner|assistant|ca|advisor|plumber|tutor)\b", re.I)
_NAME = re.compile(r"\b([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b")


def infer_subject(content: str, mtype: MemType) -> str | None:
    if mtype == MemType.CONTACT:
        r = _ROLE.search(content)
        if r:
            return f"contact:{r.group(1).lower()}"
        names = [n for n in _NAME.findall(content) if n.lower() not in _SELF and n not in ("User", "The", "Her", "His")]
        if names:
            return f"contact:{names[0].lower()}"
    if mtype == MemType.PAYMENT:
        return "payment:" + (_NAME.findall(content) or ["self"])[0].lower()
    return None


@dataclass
class GroundResult:
    cited: list[Span]
    notes: list[str] = field(default_factory=list)


def ground(cand: Candidate, spans: dict[str, Span]) -> GroundResult:
    """Never let the writer attribute content to the user unless it literally came from the user."""
    notes: list[str] = []
    cited = [spans[i] for i in cand.span_ids if i in spans]
    if not cited:
        cited = list(spans.values())
        notes.append("writer cited no valid source; treated as derived from every source in the turn")
    ids = {s.id for s in cited}

    for ent in extract_entities(cand.content):
        support = [s for s in spans.values() if ent in normalize_for_match(s.text)]
        if any(s.trust == Trust.GREEN for s in support):
            continue
        extra = [s for s in support if s.id not in ids]
        if extra:
            cited += extra
            ids |= {s.id for s in extra}
            notes.append(f"'{ent}' appears only in {', '.join(s.principal for s in extra)}; source added")

    if all(s.trust == Trust.GREEN for s in cited):
        words = content_words(cand.content) - _SELF
        if words:
            def overlap(s: Span) -> float:
                return len(words & content_words(s.text)) / len(words)

            best_green = max((overlap(s) for s in cited), default=0)
            if best_green < 0.5:
                rivals = [s for s in spans.values() if s.trust != Trust.GREEN and overlap(s) > best_green and overlap(s) >= 0.5]
                if rivals:
                    cited += rivals
                    notes.append("content matches untrusted text better than anything you said; untrusted source added")
    return GroundResult(cited, notes)


def _excerpt(span: Span, content: str) -> str:
    words = content_words(content)
    best, best_sc = span.text[:300], -1.0
    for s in re.split(r"(?<=[.!?])\s+|\n", span.text):
        sc = len(words & content_words(s))
        if sc > best_sc:
            best, best_sc = s, sc
    return truncate(best.strip(), 400)


@dataclass
class GateConfig:
    enabled: bool = True  # False = "no-gate" ablation: every candidate auto-saves as active
    use_model: bool = True


@dataclass
class MemoryEvent:
    memory: Memory
    action: str  # gate action, or "duplicate"
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"memory": self.memory.model_dump(), "action": self.action, "notes": self.notes}


class TrustGate:
    def __init__(self, store: MemoryStore, router, budget, cfg: GateConfig | None = None):
        self.store = store
        self.router = router
        self.budget = budget
        self.cfg = cfg or GateConfig()

    def process(self, cands: list[Candidate], spans: dict[str, Span], model_name: str = "") -> list[MemoryEvent]:
        if not cands:
            return []
        grounded = [(c, ground(c, spans)) for c in cands]
        trusts = [min_trust(*[s.trust for s in g.cited]) for _, g in grounded]
        verdicts = classify(self.router, [(c, t) for (c, _), t in zip(grounded, trusts, strict=True)], self.budget,
                            use_model=self.cfg.use_model)
        now = self.store.clock()
        events = []
        for (cand, g), trust, v in zip(grounded, trusts, verdicts, strict=True):
            flags = sorted({f for s in g.cited if s.trust != Trust.GREEN for f in s.flags}
                           | (set(flags_for(cand.content)) if trust != Trust.GREEN else set())
                           | ({"hidden_text"} if any(s.hidden_technique for s in g.cited) else set()))
            action = v.action if self.cfg.enabled else GateAction.auto_save
            mtype = v.type
            prov = [Provenance(kind=s.kind, ref=s.ref, principal=s.principal, trust=s.trust,
                               excerpt=_excerpt(s, cand.content), hidden_technique=s.hidden_technique,
                               captured_at=iso(now)) for s in g.cited]
            dup = self._duplicate(cand.content, mtype, trust)
            if dup is not None:
                events.append(MemoryEvent(dup, "duplicate", ["already known from an equal or higher-trust source"]))
                continue
            subject = cand.subject or infer_subject(cand.content, mtype)
            high_risk = trust != Trust.GREEN and (mtype in HIGH_RISK_TYPES or bool(flags))
            suggestion = None
            if trust != Trust.GREEN:
                bad = {"hidden_text", "hidden_instruction", "imperative_to_ai", "secrecy", "exfiltration"}
                suggestion = "reject" if (trust == Trust.RED and mtype in HIGH_RISK_TYPES) or set(flags) & bad else "approve"
            decision = GateDecision(action=action, reason=reason_for(mtype, trust, action) if self.cfg.enabled
                                    else "gate disabled (ablation)", detector_flags=flags, high_risk=high_risk,
                                    suggestion=suggestion if action == GateAction.queue_approval else None,
                                    classified_type=mtype, classifier=v.opinions)
            status = {GateAction.auto_save: Status.active, GateAction.save_as_claim: Status.claim,
                      GateAction.queue_approval: Status.pending_approval, GateAction.block: Status.rejected}[action]
            mem = Memory(type=mtype, content=cand.content, subject=subject, status=status, trust=trust,
                         provenance=prov, created_by_model=model_name, gate_decision=decision,
                         created_at=iso(now), updated_at=iso(now))
            if status == Status.claim:
                mem.expires_at = iso(now + timedelta(days=CLAIM_TTL_DAYS))
            if mtype == MemType.PAYMENT and trust == Trust.GREEN and self.cfg.enabled:
                self.store.vault_put(mem, cand.content)

            # No downward overwrite: a lower-trust write never supersedes a higher-trust memory.
            conflicts = self._conflicts(mem, cand.supersedes)
            if conflicts and self.cfg.enabled:
                top = max(conflicts, key=lambda m: TRUST_RANK[m.effective_trust])
                decision.conflict_with = top.id
                if TRUST_RANK[trust] < TRUST_RANK[top.effective_trust]:
                    if status in (Status.active, Status.claim):
                        mem.status = Status.disputed
                        decision.reason = (f"conflicts with a higher-trust memory ({top.effective_trust.value}); "
                                           "kept as disputed, your version stays active")
                    elif status == Status.pending_approval:
                        decision.reason += f"; would overwrite a {top.effective_trust.value} memory"
                        decision.suggestion = "reject"
                elif mem.status == Status.active:
                    mem.supersedes = top.id
            self.store.save(mem, f"gate:{action.value}", "vouch", note="; ".join(g.notes))
            if mem.supersedes:
                self._supersede(mem.supersedes, mem.id)
            events.append(MemoryEvent(mem, action.value, g.notes))
        return events

    def _duplicate(self, content: str, mtype: MemType, trust: Trust) -> Memory | None:
        norm = _norm(content)
        for m in self.store.list(type=mtype.value, limit=300):
            if m.status in RECALLABLE | {Status.pending_approval} and _norm(m.content) == norm \
                    and TRUST_RANK[m.effective_trust] >= TRUST_RANK[trust]:
                return m
        return None

    def _conflicts(self, mem: Memory, explicit: str | None) -> list[Memory]:
        out = []
        if explicit:
            m = self.store.get(explicit)
            if m and m.status == Status.active:
                out.append(m)
        if mem.subject:
            out += [m for m in self.store.by_subject(mem.subject) if m.id not in {o.id for o in out}
                    and _norm(m.content) != _norm(mem.content)]
        return out

    def _supersede(self, old_id: str, new_id: str) -> None:
        old = self.store.get(old_id)
        if old and old.status == Status.active:
            old.status = Status.superseded
            old.superseded_by = new_id
            self.store.save(old, "supersede", "vouch", note=f"replaced by {new_id}")

    # ------------------------------------------------------------------ user decisions (GREEN)
    def approve(self, mem_id: str, trust_source: bool = False) -> Memory | None:
        m = self.store.get(mem_id)
        if not m or m.status not in (Status.pending_approval, Status.disputed, Status.claim, Status.rejected):
            return m
        m.status = Status.active
        m.approved_by_user = True
        m.expires_at = None
        m.provenance.append(Provenance(kind="user_approval", ref="approval-inbox", principal="user",
                                       trust=Trust.GREEN, captured_at=iso(self.store.clock())))
        if m.type == MemType.PAYMENT and not m.vaulted:
            self.store.vault_put(m, m.content)
        conflict = m.gate_decision.conflict_with if m.gate_decision else None
        if conflict:
            m.supersedes = conflict
        self.store.save(m, "approve", "user", note="approved and trusted source" if trust_source else "")
        if conflict:
            self._supersede(conflict, m.id)
        return m

    def reject(self, mem_id: str) -> Memory | None:
        m = self.store.get(mem_id)
        if not m:
            return None
        m.status = Status.rejected
        m.provenance.append(Provenance(kind="user_approval", ref="approval-inbox", principal="user",
                                       trust=Trust.GREEN, excerpt="rejected", captured_at=iso(self.store.clock())))
        self.store.save(m, "reject", "user")
        return m

    def forget(self, mem_id: str) -> Memory | None:
        m = self.store.get(mem_id)
        if not m:
            return None
        m.status = Status.superseded
        self.store.save(m, "forget", "user", note="user asked to forget")
        return m


def _norm(t: str) -> str:
    return re.sub(r"\W+", " ", t.lower()).strip()
