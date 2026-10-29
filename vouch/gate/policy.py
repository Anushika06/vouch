"""The gate policy matrix (§4.3) and trust assignment from provenance (§4.2).

Trust is assigned from *where* content came from, never from what it claims.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from vouch.models import ACTION_RANK, GateAction, MemType, Trust

A = GateAction
MATRIX: dict[MemType, dict[Trust, GateAction]] = {
    MemType.PREFERENCE: {Trust.GREEN: A.auto_save, Trust.YELLOW: A.auto_save, Trust.RED: A.block},
    MemType.FACT: {Trust.GREEN: A.auto_save, Trust.YELLOW: A.auto_save, Trust.RED: A.save_as_claim},
    MemType.EVENT: {Trust.GREEN: A.auto_save, Trust.YELLOW: A.auto_save, Trust.RED: A.save_as_claim},
    MemType.CONTACT: {Trust.GREEN: A.auto_save, Trust.YELLOW: A.queue_approval, Trust.RED: A.queue_approval},
    MemType.INSTRUCTION: {Trust.GREEN: A.auto_save, Trust.YELLOW: A.queue_approval, Trust.RED: A.queue_approval},
    # GREEN payment details go to the encrypted vault after an explicit confirm.
    MemType.PAYMENT: {Trust.GREEN: A.queue_approval, Trust.YELLOW: A.queue_approval, Trust.RED: A.block},
    MemType.SKILL_NOTE: {Trust.GREEN: A.auto_save, Trust.YELLOW: A.queue_approval, Trust.RED: A.queue_approval},
}

HIGH_RISK_TYPES = {MemType.CONTACT, MemType.INSTRUCTION, MemType.PAYMENT}
# Corroboration may only ever upgrade these types (defeats SEO-style attack A6).
CORROBORATABLE = {MemType.FACT, MemType.EVENT}
CLAIM_TTL_DAYS = 30


def policy(mtype: MemType, trust: Trust) -> GateAction:
    return MATRIX[mtype][trust]


def most_restrictive(actions: list[GateAction]) -> GateAction:
    return max(actions, key=lambda a: ACTION_RANK[a])


def reason_for(mtype: MemType, trust: Trust, action: GateAction) -> str:
    if trust == Trust.GREEN:
        if mtype == MemType.PAYMENT:
            return "Payment details from you go to the encrypted vault after you confirm"
        return "You said it directly"
    src = "an allow-listed contact or your own account" if trust == Trust.YELLOW else "an untrusted source"
    return {
        A.auto_save: f"{mtype.value.title()} from {src}; saved and tagged with its source",
        A.save_as_claim: f"{mtype.value.title()} from {src}; kept as a claim attributed to the source, expires in {CLAIM_TTL_DAYS} days",
        A.queue_approval: f"{trust.value} source attempted a {mtype.value} write; needs your approval",
        A.block: f"{trust.value} source cannot set a {mtype.value}" + ("; alert raised" if mtype == MemType.PAYMENT else ""),
    }[action]


@dataclass
class TrustSettings:
    trusted_contacts: set[str] = field(default_factory=set)  # lowercase email addresses
    trusted_domains: set[str] = field(default_factory=set)  # registrable domains
    own_accounts: set[str] = field(default_factory=set)  # the user's own addresses


def trust_for_source(kind: str, principal: str, ts: TrustSettings) -> Trust:
    if kind in ("user_chat", "user_approval"):
        return Trust.GREEN
    who = principal.split(":", 1)[-1].lower()
    if kind == "email":
        if who in ts.own_accounts or who in ts.trusted_contacts:
            return Trust.YELLOW
        return Trust.RED
    if kind == "web":
        from vouch.util import registrable_domain

        return Trust.YELLOW if registrable_domain(who) in ts.trusted_domains else Trust.RED
    if kind == "agent":
        return Trust.YELLOW
    # tool and skill outputs, system-derived text: RED
    return Trust.RED
