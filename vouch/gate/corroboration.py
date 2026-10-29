"""Corroboration engine (Tavily).

A RED FACT/EVENT claim becomes a `corroborated_claim` only if at least 3 independent registrable
domains support it, after removing same-origin and near-duplicate (syndicated) pages. Corroboration
never upgrades CONTACT, INSTRUCTION, PAYMENT or PREFERENCE — that is what defeats SEO-style attacks.
"""

from __future__ import annotations

import concurrent.futures as cf
import re
from datetime import timedelta
from typing import TYPE_CHECKING

from vouch.gate.policy import CLAIM_TTL_DAYS, CORROBORATABLE
from vouch.models import Corroboration, Memory, Status
from vouch.reader.detector import split_html
from vouch.util import containment, iso, registrable_domain, shingles, truncate

if TYPE_CHECKING:
    from vouch.workspace import Workspace

MIN_INDEPENDENT = 3
NEAR_DUP = 0.5
_ATTRIB = re.compile(r"^[\w.-]+\.\w+ (?:says|claims|reports|states)(?: that)? ", re.I)


def claim_text(mem: Memory) -> str:
    return _ATTRIB.sub("", mem.content).strip()


def corroborate(ws: Workspace, mem: Memory, demo_only: bool = False) -> Corroboration:
    rules = ws.cfg.corroboration_rules
    if rules and (mem.type not in CORROBORATABLE or mem.status not in (Status.claim, Status.corroborated_claim)):
        c = Corroboration(note=f"{mem.type.value} memories are never upgraded by corroboration"
                          if mem.type not in CORROBORATABLE else f"only claims can be corroborated (status {mem.status.value})")
        mem.corroboration = c
        ws.store.save(mem, "corroborate", "vouch", note=c.note)
        return c

    claim = claim_text(mem)
    origins = {registrable_domain(p.principal.split(":", 1)[1]) for p in mem.provenance if p.principal.startswith("domain:")}
    origin_sh = [shingles(p.excerpt) for p in mem.provenance if p.excerpt and p.trust.value != "GREEN"]
    results = ws.web.search(claim, max_results=8, demo_only=demo_only)

    kept, filtered = [], []
    seen_domains: set[str] = set()
    for r in results:
        dom = registrable_domain(r.url)
        text = r.content
        page = ws.demo_web.page(r.url)
        if page:
            text = split_html(page[1]).visible
        sh = shingles(text)
        if rules:
            if dom in origins:
                filtered.append({"url": r.url, "domain": dom, "why": "same origin as the claim"})
                continue
            if dom in seen_domains:
                filtered.append({"url": r.url, "domain": dom, "why": "domain already counted"})
                continue
            if any(containment(sh, o) > NEAR_DUP for o in origin_sh + [k["sh"] for k in kept]):
                filtered.append({"url": r.url, "domain": dom, "why": "near-duplicate / syndicated text"})
                continue
        seen_domains.add(dom)
        kept.append({"url": r.url, "domain": dom, "text": text, "sh": sh})

    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        verdicts = list(ex.map(lambda k: ws.reader.judge_support(claim, k["text"], f"domain:{k['domain']}"), kept))
    sup = [{"url": k["url"], "domain": k["domain"], "excerpt": truncate(k["text"], 240)}
           for k, v in zip(kept, verdicts, strict=True) if v == "supports"]
    dis = [{"url": k["url"], "domain": k["domain"], "excerpt": truncate(k["text"], 240)}
           for k, v in zip(kept, verdicts, strict=True) if v == "contradicts"]
    independent = len({s["domain"] for s in sup})
    upgraded = independent >= MIN_INDEPENDENT and independent > len(dis)
    c = Corroboration(supporting=sup, disputing=dis, filtered=filtered, independent_domains=independent,
                      upgraded=upgraded,
                      note=f"{independent} independent source(s) agree, {len(dis)} dispute"
                      + ("" if rules else " (corroboration rules disabled: ablation)"))
    mem.corroboration = c
    if upgraded:
        mem.status = Status.corroborated_claim
        mem.expires_at = iso(ws.now() + timedelta(days=CLAIM_TTL_DAYS))
    ws.store.save(mem, "corroborate", "vouch", note=c.note)
    return c
