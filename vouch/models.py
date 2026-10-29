"""Core data model: trust tiers, memory records, provenance, gate decisions."""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field

from vouch.util import iso, new_id, sha256


class Trust(StrEnum):
    GREEN = "GREEN"  # the user directly
    YELLOW = "YELLOW"  # the user's own accounts / allow-listed contacts
    RED = "RED"  # everything else


TRUST_RANK = {Trust.RED: 0, Trust.YELLOW: 1, Trust.GREEN: 2}


def min_trust(*trusts: Trust | str) -> Trust:
    """Taint rule: content derived from several sources gets the lowest trust among them."""
    ts = [Trust(t) for t in trusts if t]
    if not ts:
        return Trust.RED
    return min(ts, key=lambda t: TRUST_RANK[t])


class MemType(StrEnum):
    PREFERENCE = "PREFERENCE"
    FACT = "FACT"
    EVENT = "EVENT"
    CONTACT = "CONTACT"
    INSTRUCTION = "INSTRUCTION"
    PAYMENT = "PAYMENT"
    SKILL_NOTE = "SKILL_NOTE"


class Status(StrEnum):
    active = "active"
    claim = "claim"
    corroborated_claim = "corroborated_claim"
    pending_approval = "pending_approval"
    rejected = "rejected"
    disputed = "disputed"
    expired = "expired"
    superseded = "superseded"


# Statuses whose content may be recalled into an agent's context at all.
RECALLABLE = {Status.active, Status.claim, Status.corroborated_claim}


class GateAction(StrEnum):
    auto_save = "auto_save"
    save_as_claim = "save_as_claim"
    queue_approval = "queue_approval"
    block = "block"


ACTION_RANK = {
    GateAction.auto_save: 0,
    GateAction.save_as_claim: 1,
    GateAction.queue_approval: 2,
    GateAction.block: 3,
}

SourceKind = Literal["user_chat", "email", "web", "tool", "skill", "system", "user_approval", "agent"]


class Provenance(BaseModel):
    kind: SourceKind
    ref: str
    principal: str
    trust: Trust
    excerpt: str = ""
    excerpt_hash: str = ""
    captured_at: str = Field(default_factory=iso)
    hidden_technique: str | None = None  # e.g. "css:display-none" if the excerpt was invisible to a human

    def model_post_init(self, __context: Any) -> None:
        if self.excerpt and not self.excerpt_hash:
            self.excerpt_hash = sha256(self.excerpt)


class GateDecision(BaseModel):
    action: GateAction
    reason: str
    detector_flags: list[str] = []
    high_risk: bool = False
    suggestion: Literal["approve", "reject"] | None = None
    classified_type: MemType | None = None
    classifier: dict[str, Any] = {}
    conflict_with: str | None = None


class Corroboration(BaseModel):
    checked_at: str = Field(default_factory=iso)
    supporting: list[dict] = []  # {domain, url, excerpt}
    disputing: list[dict] = []
    filtered: list[dict] = []  # dropped as same-origin / near-duplicate
    independent_domains: int = 0
    upgraded: bool = False
    note: str = ""


class Memory(BaseModel):
    id: str = Field(default_factory=lambda: new_id("mem"))
    type: MemType
    content: str
    subject: str | None = None  # stable key for conflict detection, e.g. "contact:accountant"
    status: Status
    trust: Trust
    provenance: list[Provenance]
    created_by_model: str = ""
    gate_decision: GateDecision | None = None
    supersedes: str | None = None
    superseded_by: str | None = None
    expires_at: str | None = None
    approved_by_user: bool = False
    vaulted: bool = False  # PAYMENT content is kept encrypted, the ledger stores a masked copy
    corroboration: Corroboration | None = None
    created_at: str = Field(default_factory=iso)
    updated_at: str = Field(default_factory=iso)
    used_in: list[str] = []

    @property
    def effective_trust(self) -> Trust:
        return Trust.GREEN if self.approved_by_user else self.trust

    def source_label(self) -> str:
        p = self.provenance[0] if self.provenance else None
        if not p:
            return "unknown"
        return p.principal


class Span(BaseModel):
    """A piece of evidence the memory writer may cite."""

    id: str
    kind: SourceKind
    ref: str
    principal: str
    trust: Trust
    text: str
    hidden_technique: str | None = None
    flags: list[str] = []


class Candidate(BaseModel):
    content: str
    type: MemType | None = None
    subject: str | None = None
    span_ids: list[str] = []
    supersedes: str | None = None
    origin: str = "writer"  # writer | detector | user_action | mcp
