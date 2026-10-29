"""Taint check for side-effecting tool calls.

An argument is tainted if it comes from a non-GREEN value (a handle), from a memory the user never
approved, or — for literal recipients/URLs the planner wrote itself — if it cannot be grounded in
something the user said or a trusted memory. Tainted calls pause for confirmation.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from vouch.interpreter.values import MEM_RE, Value
from vouch.models import Trust
from vouch.util import EMAIL_RE, domain_of, extract_entities, normalize_for_match, registrable_domain

# tool -> (recipient-like args, content args)
SIDE_EFFECTS: dict[str, tuple[list[str], list[str]]] = {
    "send_email": (["to", "cc", "bcc"], ["subject", "body", "attachments"]),
    "create_event": (["attendees"], ["title", "notes", "location", "start", "end"]),
    "create_task": ([], ["title", "due"]),
    "install_skill": (["name"], []),
    "http_post": (["url"], ["body"]),
    "delete_memory": (["memory_id"], []),
}


@dataclass
class GroundingContext:
    green_texts: list[str]  # what the user said this session + GREEN/approved memories
    untrusted: list[tuple[str, str, Trust]]  # (principal, text, trust) for everything else seen
    trusted_addresses: set[str] = field(default_factory=set)

    def __post_init__(self):
        self._green = normalize_for_match("\n".join(self.green_texts))
        self._green_emails = {e.lower() for e in EMAIL_RE.findall("\n".join(self.green_texts))} | self.trusted_addresses

    def address_ok(self, addr: str) -> bool:
        return addr.lower() in self._green_emails

    def green_has(self, atom: str) -> bool:
        return atom.lower() in self._green

    def found_in(self, atom: str) -> list[tuple[str, Trust]]:
        a = atom.lower()
        return [(p, t) for p, txt, t in self.untrusted if a in normalize_for_match(txt)]


@dataclass
class TaintItem:
    arg: str
    value: str
    trust: Trust
    source: str
    reason: str

    def as_dict(self) -> dict:
        return {"arg": self.arg, "value": self.value, "trust": self.trust.value, "source": self.source,
                "reason": self.reason}


def _atoms(v) -> list[str]:
    if isinstance(v, list):
        return [str(x) for x in v if x]
    return [str(v)] if v else []


def check(tool: str, raw_args: dict, resolved: dict, used: list[Value], mem_trust: dict[str, tuple[Trust, bool]],
          ctx: GroundingContext) -> list[TaintItem]:
    if tool not in SIDE_EFFECTS and not tool.startswith("delete_"):
        return []
    recips, contents = SIDE_EFFECTS.get(tool, ([], []))
    items: list[TaintItem] = []

    # 1) Values that flowed in through handles carry their source's trust.
    for v in used:
        if v.trust != Trust.GREEN:
            arg = next((k for k, rv in raw_args.items() if v.handle in str(rv)), "?")
            items.append(TaintItem(arg, str(v.value)[:200], v.trust, v.source,
                                   f"value came from {v.source} ({v.trust.value}) via {v.handle}"))

    # 2) Memory references: only GREEN or user-approved memories may drive actions.
    for k, rv in raw_args.items():
        for mref in MEM_RE.findall(str(rv)):
            t, approved = mem_trust.get(mref[1:], (Trust.RED, False))
            if t != Trust.GREEN and not approved:
                items.append(TaintItem(k, mref, t, mref, "memory was never approved by you"))

    # 3) Literal recipients / URLs must be grounded in what you said or a trusted memory.
    for k in recips:
        for atom in _atoms(resolved.get(k)):
            if tool == "http_post" or k == "url":
                dom = registrable_domain(atom)
                if not ctx.green_has(dom):
                    srcs = ctx.found_in(domain_of(atom))
                    items.append(TaintItem(k, atom, srcs[0][1] if srcs else Trust.RED, srcs[0][0] if srcs else "planner",
                                           "destination not provided by you"))
                continue
            if tool == "install_skill":
                continue  # skills go through their own scan + approval flow
            for addr in EMAIL_RE.findall(atom) or [atom]:
                if ctx.address_ok(addr):
                    continue
                srcs = ctx.found_in(addr)
                if srcs:
                    p, t = srcs[0]
                    items.append(TaintItem(k, addr, t, p, f"address appears only in content from {p}"))
                else:
                    items.append(TaintItem(k, addr, Trust.RED, "planner",
                                           "address is not from you or any trusted memory"))

    # 4) Literal content that smuggles untrusted addresses/links (e.g. "also send to x@y" in the body).
    for k in contents:
        for atom in _atoms(resolved.get(k)):
            for ent in extract_entities(atom):
                if ctx.green_has(ent) or ctx.address_ok(ent):
                    continue
                srcs = ctx.found_in(ent)
                if srcs:
                    items.append(TaintItem(k, ent, srcs[0][1], srcs[0][0], f"'{ent}' came from {srcs[0][0]}"))

    seen, out = set(), []
    for it in items:
        key = (it.arg, it.value)
        if key not in seen:
            seen.add(key)
            out.append(it)
    return out
