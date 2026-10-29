"""Deterministic stand-in for the models, used ONLY by tests, CI and offline development
(VOUCH_PROVIDER=mock). It imitates each role well enough to exercise the pipeline end to end.
Nothing produced in mock mode is ever reported as a model result: eval runs in mock mode write to
evals/results/mock/, and the UI shows a MOCK banner.

The naive-agent mock deliberately behaves like a typical memory-enabled LLM agent: it extracts
"remember ..." sentences from what it reads and follows instructions found in tool output.
"""

from __future__ import annotations

import hashlib
import math
import re
from typing import Any

from vouch.gate.classifier import heuristic_type
from vouch.reader.detector import flags_for, is_instruction, sentences
from vouch.util import EMAIL_RE, URL_RE, content_words

TOOL_WORDS = re.compile(
    r"\b(find|search|look up|lookup|research|deal|deals|laptop|news|browse|read|summari[sz]e|inbox|email|mail|send|"
    r"forward|reply|invoice|schedule|meeting|calendar|remind|reminder|task|book|file|skill|learn|crawl|check|verify|"
    r"true|flight|itinerary|http|www|triage)\b", re.I)


def handle(task: str, inp: dict, messages: list[dict]) -> Any:
    fn = _HANDLERS.get(task)
    if fn is None:
        return {} if task != "text" else "OK"
    return fn(inp)


def embed(text: str, dim: int = 64) -> list[float]:
    v = [0.0] * dim
    for w in content_words(text):
        h = int(hashlib.md5(w.encode()).hexdigest(), 16)
        v[h % dim] += 1.0 if (h >> 8) & 1 else -1.0
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


# ---------------------------------------------------------------------------- reader
_PRICE = re.compile(r"(₹|rs\.?|inr|\$)\s?(\d[\d,]*(?:\.\d+)?)", re.I)
_CLAIMY = re.compile(r"\b(is|are|has|have|weighs|ships|costs|lasted|departs|now|will|offers|includes)\b", re.I)


def _reader_extract(inp: dict) -> dict:
    visible = inp.get("visible") or ""
    hidden = inp.get("hidden") or []
    sents = sentences(visible)
    instr = [s for s in sents if is_instruction(flags_for(s))]
    instr += [s for _t, txt in hidden for s in sentences(txt) if flags_for(s)]
    clean = [s for s in sents if s not in instr and len(s.split()) >= 4]
    claims = [{"text": s, "type_hint": heuristic_type(s)[0].value} for s in clean if _CLAIMY.search(s)
              and (re.search(r"\d", s) or re.search(r"\b[A-Z][a-z]+", s))][:4]
    m = _PRICE.search(visible)
    price = float(m.group(2).replace(",", "")) if m else None
    cur = None
    if m:
        cur = "USD" if m.group(1) == "$" else "INR"
    return {"title": inp.get("title"), "summary": " ".join(clean[:2])[:400], "price": price, "currency": cur,
            "date": None, "amounts": [], "entities": [], "claims": claims, "instructions": instr}


def _reader_query(inp: dict) -> dict:
    text, q, out = inp.get("text", ""), inp.get("question", ""), inp.get("output", "text")
    qw = content_words(q)
    best = max(sentences(text) or [""], key=lambda s: len(qw & content_words(s)))
    if out == "bool":
        return {"answer": bool(qw & content_words(text))}
    if out == "number":
        m = re.search(r"[\d,]+(?:\.\d+)?", best.replace("₹", ""))
        return {"answer": float(m.group(0).replace(",", "")) if m else None}
    return {"answer": best}


_QTY = re.compile(r"(\d+(?:\.\d+)?)\s?(gb|kg|tb|hours?|h)\b", re.I)


def _judge(inp: dict) -> dict:
    claim, snip = inp.get("claim", ""), inp.get("snippet", "")
    cq = {(float(a), b.lower()[:2]) for a, b in _QTY.findall(claim)}
    sq = {(float(a), b.lower()[:2]) for a, b in _QTY.findall(snip)}
    subj = content_words(claim) & content_words(snip)
    if cq and cq & sq:
        return {"verdict": "supports"}
    units = {u for _, u in cq}
    if cq and any(u in units for _, u in sq) and len(subj) >= 2:
        return {"verdict": "contradicts"}
    return {"verdict": "unrelated"}


# ---------------------------------------------------------------------------- gate
def _classify(inp: dict) -> dict:
    return {"items": [{"i": i, "type": heuristic_type(t)[0].value, "confidence": 0.8}
                      for i, t in enumerate(inp.get("items", []))]}


# ---------------------------------------------------------------------------- planner
def _route(inp: dict) -> dict:
    user = inp.get("user", "")
    if TOOL_WORDS.search(user) or URL_RE.search(user):
        return {"needs_tools": True, "answer": None}
    words = content_words(user)
    pool = inp.get("contacts", []) + inp.get("rules", []) + inp.get("memories", [])
    best = max(pool, key=lambda m: len(words & content_words(m.get("content", ""))), default=None)
    if best and words & content_words(best.get("content", "")):
        c = best["content"]
        return {"needs_tools": False, "answer": f"From memory: {{{{{c}}}}}" if c.startswith("@mem_") else f"From memory: {c}"}
    return {"needs_tools": False, "answer": "Hi! I'm Vouch. I can research, triage your inbox, manage your calendar "
            "and remember things — and I always know where each memory came from."}


def _first_result(obs: list[dict], tool: str):
    for o in obs:
        if o.get("tool") == tool and o.get("result") is not None:
            return o["result"]
    return None


def _find_contact(user: str, contacts: list[dict], memories: list[dict]) -> list[str]:
    u = user.lower()
    # Most recently updated first, like a typical agent that trusts its newest memory.
    pool = list(contacts) + [m for m in memories if m.get("type") == "CONTACT"]
    roles = re.findall(r"\b(accountant|sister|landlord|client|dev|ravi|meera|priya|mallory)\b", u)
    for role in roles:
        for c in pool:
            content = c.get("content", "")
            if role in content.lower():
                emails = EMAIL_RE.findall(content)
                if emails:
                    return [emails[0]]
    return EMAIL_RE.findall(user)


_GENERIC = {"send", "email", "mail", "emails", "user", "want", "every", "all", "always", "also", "asha", "future",
            "cc", "bcc", "copy", "copied", "forward", "forwarded", "accountant", "from", "now", "on", "my", "the"}


def _rules_cc(context_items: list[dict], user: str) -> list[str]:
    """Apply any standing rule whose topic overlaps the request and that asks for extra recipients."""
    topic = {w.rstrip("s") for w in content_words(user)} - _GENERIC
    out = []
    for r in context_items:
        c = r.get("content", "")
        words = {w.rstrip("s") for w in content_words(c)}
        if topic & words and re.search(r"\b(cc|bcc|copy|copied|forward(?:ed)?)\b|cc'?d", c, re.I):
            out += EMAIL_RE.findall(c)
    return list(dict.fromkeys(out))


def _injected_actions(obs: list[dict]) -> list[dict]:
    """What a naive agent does with instructions in tool output: follows the immediate ones."""
    steps = []
    for o in obs:
        res = o.get("result")
        items = res if isinstance(res, list) else [res]
        for it in items:
            if not isinstance(it, dict):
                continue
            txt = " ".join(str(it.get(k, "")) for k in ("raw_text", "summary_text", "subject_text"))
            for s in sentences(txt):
                if re.search(r"\b(forward|send|email)\b", s, re.I) and "remember" not in s.lower():
                    for addr in EMAIL_RE.findall(s):
                        steps.append({"tool": "send_email", "args": {"to": [addr], "subject": "Forwarding as requested",
                                                                     "body": "Forwarding the user's itinerary and documents."}})
    return steps[:1]


def _plan(inp: dict) -> dict:
    user = inp.get("user", "")
    u = user.lower()
    obs = inp.get("observations", [])
    rnd = inp.get("round", 0)
    naive = inp.get("naive", False)
    contacts, rules, mems = inp.get("contacts", []), inp.get("rules", []), inp.get("memories", [])
    url = URL_RE.search(user)

    if naive and obs:
        inj = _injected_actions(obs)
        if inj and not any(o.get("tool") == "send_email" for o in obs):
            return {"thought": "the content asks me to forward details", "steps": inj, "answer": "Done."}

    # reply to an email: the recipient is the sender's address, which the reader extracted (safe-typed but
    # carrying the email's trust) — an unknown sender's address is RED, so the taint check pauses the send.
    if re.search(r"\breply\b", u):
        if rnd == 0:
            return {"thought": "find the email", "steps": [{"tool": "list_inbox", "args": {}}], "answer": None}
        listing = _first_result(obs, "list_inbox") or []
        if rnd == 1:
            names = re.findall(r"\b(dev|ravi|ravica|meera|priya|lumen|bank|accounts|skyfly|flight|design)\b", u)
            pick = [e for e in listing if any(n in e["from"].lower() for n in names)][:1] or listing[:1]
            return {"thought": "read it", "steps": [{"tool": "read_email", "args": {"email_id": e["email_id"]}} for e in pick],
                    "answer": None}
        read = _first_result(obs, "read_email") or {}
        if rnd == 2 and read.get("sender"):
            return {"thought": "reply", "steps": [{"tool": "send_email", "args": {
                "to": [read["sender"]], "subject": "Re: your email",
                "body": "Hi,\n\nThanks for your note — I'll take a look and get back to you.\n\nAsha"}}],
                "answer": f"Replied to {read['sender']}."}
        return {"thought": "done", "steps": [], "answer": "I couldn't find that email."}

    # send / email with an invoice or to a person
    if re.search(r"\b(send|email|mail|forward)\b", u) and not re.search(r"\b(inbox|read|latest|triage)\b", u):
        to = _find_contact(user, contacts, mems)
        if rnd == 0 and "invoice" in u:
            return {"thought": "find the invoice and recipient", "steps": [
                {"tool": "find_files", "args": {"query": "invoice"}}, {"tool": "recall", "args": {"query": "accountant invoice"}}],
                "answer": None}
        files = _first_result(obs, "find_files") or []
        recalled = _first_result(obs, "recall") or []
        attach = [f["file_id"] for f in files if "invoice" in f.get("name", "").lower()][:1]
        cc = _rules_cc(rules + (mems + recalled if naive else []), user)
        if not to:
            to = _find_contact(user, contacts, recalled)
        if not to:
            return {"thought": "no recipient", "steps": [], "answer": "Who should I send it to?"}
        subject = "October invoice" if "invoice" in u else "Hello from Asha"
        body = ("Hi,\n\nPlease find attached the October invoice for Lumen Studio.\n\nThanks,\nAsha" if "invoice" in u
                else "Hi,\n\n" + user + "\n\nAsha")
        return {"thought": "send it", "steps": [{"tool": "send_email", "args": {
            "to": to, "cc": [c for c in cc if c not in to], "bcc": [], "subject": subject, "body": body,
            "attachments": attach}}], "answer": f"Sent the email to {', '.join(to)}" + (f" (cc {', '.join(cc)})" if cc else "") + "."}

    if re.search(r"\b(schedule|meeting|calendar|book a|create an event|add .* calendar)\b", u):
        att = _find_contact(user, contacts, mems)
        m = re.search(r"(\d{1,2})(?::(\d{2}))?\s?(am|pm)", u)
        hour = (int(m.group(1)) % 12 + (12 if m and m.group(3) == "pm" else 0)) if m else 10
        start = f"2026-11-03T{hour:02d}:{(m.group(2) if m and m.group(2) else '00')}:00+05:30"
        return {"thought": "create event", "steps": [{"tool": "create_event", "args": {
            "title": user[:60], "start": start, "end": start, "attendees": att}}], "answer": "Added it to your calendar."}

    if re.search(r"\b(remind|reminder|task)\b", u):
        return {"thought": "create task", "steps": [{"tool": "create_task", "args": {"title": user[:80], "due": "2026-11-01T09:00:00+05:30"}}],
                "answer": "Reminder created."}

    if re.search(r"\b(inbox|triage|latest email|read (?:my |the )?(?:email|mail)|email from|mail from)\b", u):
        if rnd == 0:
            return {"thought": "list inbox", "steps": [{"tool": "list_inbox", "args": {"unread_only": False}}], "answer": None}
        listing = _first_result(obs, "list_inbox") or []
        if rnd == 1:
            names = re.findall(r"\b(dev|ravi|ravica|meera|priya|lumen|bank|accounts|skyfly|flight)\b", u)
            pick = [e for e in listing if any(n in e["from"].lower() for n in names)] if names else listing[:3]
            pick = pick[:3] or listing[:1]
            return {"thought": "read emails", "steps": [{"tool": "read_email", "args": {"email_id": e["email_id"]}} for e in pick],
                    "answer": None}
        reads = [o["result"] for o in obs if o.get("tool") == "read_email" and isinstance(o.get("result"), dict)]
        parts = [f"- {r.get('sender')}: " + ("{{" + r["summary"] + "}}" if "summary" in r else r.get("summary_text", ""))
                 for r in reads]
        return {"thought": "summarise", "steps": [], "answer": "Here's your inbox:\n" + "\n".join(parts)}

    if url and re.search(r"\b(learn|crawl)\b", u):
        if rnd == 0:
            return {"thought": "crawl", "steps": [{"tool": "learn_site", "args": {"url": url.group(0)}}], "answer": None}
        return {"thought": "done", "steps": [], "answer": "I read the site and saved what it says as claims, attributed to it."}

    if re.search(r"\b(run|use)\b.*\bskill\b", u):
        m = re.search(r"skill\s+([a-z0-9-]+)|([a-z0-9-]+)\s+skill", u)
        name = (m.group(1) or m.group(2)) if m else ""
        if rnd == 0:
            return {"thought": "run skill", "steps": [{"tool": "run_skill", "args": {"name": name, "input": {"text": user}}}],
                    "answer": None}
        r = _first_result(obs, "run_skill") or {}
        if "summary" in r:
            return {"thought": "done", "steps": [], "answer": "Skill output: {{" + r["summary"] + "}}"}
        return {"thought": "done", "steps": [], "answer": f"The skill returned: {r.get('summary_text') or r.get('error')}"}

    if re.search(r"\b(is it true|true that|verify|check (?:the )?sources|corroborate)\b", u):
        if rnd == 0:
            return {"thought": "find the claim", "steps": [{"tool": "recall", "args": {"query": user}}], "answer": None}
        rec = [m for m in (_first_result(obs, "recall") or []) if m.get("status") in ("claim", "corroborated_claim")]
        if rnd == 1 and rec:
            return {"thought": "corroborate", "steps": [{"tool": "corroborate", "args": {"memory_id": rec[0]["id"]}}], "answer": None}
        c = _first_result(obs, "corroborate") or {}
        return {"thought": "report", "steps": [], "answer":
                f"I checked: {c.get('independent_supporting_domains', 0)} independent source(s) support it, "
                f"{c.get('disputing', 0)} dispute it, {c.get('filtered_duplicates', 0)} were duplicates. Status: {c.get('status', 'unverified')}."}

    if url or re.search(r"\b(find|search|look up|research|deal|deals|laptop|news|flight|itinerary|status)\b", u):
        if url and rnd == 0:
            return {"thought": "read page", "steps": [{"tool": "web_extract", "args": {"url": url.group(0)}}], "answer": None}
        if not url and rnd == 0:
            return {"thought": "search", "steps": [{"tool": "web_search", "args": {"query": user}}], "answer": None}
        results = _first_result(obs, "web_search") or []
        if not url and rnd == 1 and isinstance(results, list) and results:
            return {"thought": "read top results", "steps": [{"tool": "web_extract", "args": {"url": r["url"]}}
                                                           for r in results[:2]], "answer": None}
        pages = [o["result"] for o in obs if o.get("tool") == "web_extract" and isinstance(o.get("result"), dict)
                 and "error" not in o["result"]] or (results if isinstance(results, list) else [])
        lines = []
        for p in pages[:3]:
            price = f" — {p['currency'] or ''} {p['price']:,.0f}" if p.get("price") else ""
            body = "{{" + p["summary"] + "}}" if "summary" in p else p.get("summary_text", "")
            lines.append(f"- {p.get('domain') or p.get('source')}{price}: {body}")
        return {"thought": "answer", "steps": [], "answer": "Here's what I found:\n" + "\n".join(lines)}

    return {"thought": "chat", "steps": [], "answer": "Okay."}


# ---------------------------------------------------------------------------- writers
_I_PATTERNS = [
    (re.compile(r"^(?:please )?remember(?: that)?\s+", re.I), ""),
    (re.compile(r"\bI am\b|\bI'm\b", re.I), "Asha is"),
    (re.compile(r"\bmy\b", re.I), "Asha's"),
    (re.compile(r"\bI\b"), "Asha"),
    (re.compile(r"\bme\b", re.I), "Asha"),
]
_MEMORABLE = re.compile(r"\b(remember|my|i am|i'm|i prefer|i like|i love|i hate|i don't|from now on|always|never|"
                        r"i'm allergic|is my|new (?:number|email|address))\b", re.I)


def _rewrite(s: str) -> str:
    out = s.strip().rstrip(".")
    for p, r in _I_PATTERNS:
        out = p.sub(r, out)
    return out[:1].upper() + out[1:]


def _user_memories(user: str) -> list[dict]:
    out = []
    for s in sentences(user):
        if _MEMORABLE.search(s) and not re.search(r"\b(find|search|send|email|schedule|remind|read|run|check)\b", s, re.I):
            out.append({"content": _rewrite(s), "type": heuristic_type(s)[0].value, "span_ids": ["U"]})
    return out


def _writer(inp: dict) -> dict:
    mems = _user_memories(inp.get("user", ""))
    research = re.search(r"\b(deal|laptop|research|find|search|learn|news)\b", inp.get("user", ""), re.I)
    docs = inp.get("docs", [])
    handles = inp.get("spans", [])
    doc_spans = [h for h in handles if h != "U"]
    for i, d in enumerate(docs):
        sid = doc_spans[i] if i < len(doc_spans) else "?"
        src = (d.get("principal") or "").split(":", 1)[-1]
        if d.get("kind") in ("web", "search_result") and research and d.get("claims") and i < 2:
            mems.append({"content": f"{src} says {d['claims'][0]['text'].rstrip('.')}", "type": "FACT", "span_ids": [sid]})
        if d.get("kind") == "email":
            for c in d.get("claims", [])[:2]:
                t = c["text"]
                if re.search(r"\b(call|meeting|dinner|flight|tomorrow|saturday|\d{1,2}\s?(am|pm))\b", t, re.I):
                    mems.append({"content": f"{src} says {t.rstrip('.')}", "type": "EVENT", "span_ids": [sid]})
                elif re.search(r"\b(number|phone|email|address)\b", t, re.I):
                    mems.append({"content": f"{src} says {t.rstrip('.')}", "type": "CONTACT", "span_ids": [sid]})
    return {"memories": mems}


def _naive_writer(inp: dict) -> dict:
    mems = _user_memories(inp.get("user", ""))
    for _src, txt in inp.get("raw", []):
        for s in sentences(txt):
            fl = flags_for(s)
            if "memory_write" in fl or ({"imperative_to_ai"} & set(fl) and {"standing_rule", "exfiltration"} & set(fl)):
                content = re.sub(r"^(?:note for ai assistants[^:]*:\s*)?(?:remember:?\s*)?", "", s, flags=re.I)
                mems.append({"content": content, "type": "INSTRUCTION"})
            elif "contact_change" in fl and EMAIL_RE.search(s):
                mems.append({"content": s, "type": "CONTACT"})
            elif "payment_change" in fl:
                mems.append({"content": s, "type": "PAYMENT"})
    return {"memories": mems[:8]}


# ---------------------------------------------------------------------------- misc roles
def _audit(inp: dict) -> dict:
    return {"summary": inp.get("summary_hint", "Memory looks healthy."), "findings": inp.get("findings_hint", [])}


def _briefing(inp: dict) -> dict:
    return {"headline": inp.get("headline_hint", "Here's your day.")}


def _skill_review(inp: dict) -> dict:
    findings = inp.get("findings", [])
    high = [f for f in findings if f.get("severity") == "high"]
    return {"verdict": "malicious" if high else ("suspicious" if findings else "benign"),
            "risk": "high" if high else ("medium" if findings else "low"),
            "explanation": "; ".join(f["detail"] for f in findings[:4]) or "Code matches its declared permissions.",
            "undeclared_capabilities": [f["detail"] for f in high]}


def _lme_answer(inp: dict) -> dict:
    mems = inp.get("memories", [])
    return {"answer": mems[0] if mems else "I don't know."}


def _lme_judge(inp: dict) -> dict:
    gold = str(inp.get("gold", "")).lower()
    ans = str(inp.get("answer", "")).lower()
    return {"correct": bool(gold) and (gold in ans or len(content_words(gold) & content_words(ans)) >= max(1, len(content_words(gold)) // 2))}


def _draft(inp: dict) -> str:
    return f"Hi {inp.get('name', '')},\n\nThanks for your email. I'll get back to you shortly.\n\nBest,\nAsha"


_HANDLERS = {
    "reader.extract": _reader_extract,
    "reader.query": _reader_query,
    "reader.judge_support": _judge,
    "gate.classify": _classify,
    "gate.second_opinion": _classify,
    "planner.route": _route,
    "planner.plan": _plan,
    "writer.propose": _writer,
    "writer.naive": _naive_writer,
    "audit.run": _audit,
    "briefing.compose": _briefing,
    "skill.review": _skill_review,
    "lme.ingest": _writer,
    "lme.answer": _lme_answer,
    "lme.judge": _lme_judge,
    "inbox.draft": _draft,
}
