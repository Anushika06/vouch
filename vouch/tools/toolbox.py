"""Tools the planner may call. Untrusted outputs pass through the Quarantined Reader and come back to
the planner as handles; side-effecting tools are taint-checked by the interpreter before they run."""

from __future__ import annotations

import concurrent.futures as cf
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from vouch.interpreter.values import Value, ValueStore
from vouch.models import Span, Status, Trust
from vouch.reader.reader import QuarantinedReader, RawDoc, ReaderOutput
from vouch.util import content_words, domain_of, iso, new_id, registrable_domain

if TYPE_CHECKING:
    from vouch.workspace import Workspace

TOOL_SPECS: list[dict] = [
    {"name": "web_search", "args": {"query": "str"}, "desc": "Search the web (Tavily). Returns result docs (RED)."},
    {"name": "web_extract", "args": {"url": "str|handle"}, "desc": "Read a full web page (Tavily extract). Returns a doc (RED)."},
    {"name": "deep_research", "args": {"question": "str"}, "desc": "Multi-source research report with citations (Tavily research)."},
    {"name": "learn_site", "args": {"url": "str"}, "desc": "Crawl a site's pages (Tavily crawl/map) and learn from them."},
    {"name": "list_inbox", "args": {"unread_only": "bool"}, "desc": "List emails in the inbox."},
    {"name": "read_email", "args": {"email_id": "str"}, "desc": "Read one email. Returns a doc (YELLOW if sender is trusted, else RED)."},
    {"name": "send_email", "args": {"to": "[str]", "cc": "[str]", "bcc": "[str]", "subject": "str", "body": "str",
                                    "attachments": "[file_id]"}, "desc": "Send an email (goes to the Outbox). SIDE EFFECT.",
     "side_effect": True},
    {"name": "list_events", "args": {"days": "int"}, "desc": "List calendar events for the next N days."},
    {"name": "create_event", "args": {"title": "str", "start": "ISO datetime", "end": "ISO datetime",
                                      "attendees": "[email]", "location": "str", "notes": "str"},
     "desc": "Create a calendar event. SIDE EFFECT.", "side_effect": True},
    {"name": "list_tasks", "args": {}, "desc": "List open tasks/reminders."},
    {"name": "create_task", "args": {"title": "str", "due": "ISO datetime"}, "desc": "Create a reminder. SIDE EFFECT.",
     "side_effect": True},
    {"name": "find_files", "args": {"query": "str"}, "desc": "Find the user's own files (invoices, statements)."},
    {"name": "recall", "args": {"query": "str"}, "desc": "Search memory."},
    {"name": "query_doc", "args": {"handle": "handle", "question": "str", "output": "bool|number|enum|text"},
     "desc": "Ask a narrow question about an untrusted doc; returns a typed value (text answers stay handles)."},
    {"name": "corroborate", "args": {"memory_id": "@mem id"},
     "desc": "Check an unverified claim against independent sources (Tavily) and report agreement."},
    {"name": "run_skill", "args": {"name": "str", "input": "object"}, "desc": "Run an installed skill (sandboxed). Output is RED."},
    {"name": "http_post", "args": {"url": "str", "body": "str"}, "desc": "POST to a URL. SIDE EFFECT. Disabled in hosted mode.",
     "side_effect": True},
]
SPEC_BY_NAME = {t["name"]: t for t in TOOL_SPECS}


@dataclass
class TurnCtx:
    turn_id: str
    user_text: str
    demo_only: bool = False
    docs: list[ReaderOutput] = field(default_factory=list)
    spans: dict[str, Span] = field(default_factory=dict)
    used_memories: list[str] = field(default_factory=list)
    trace: list[dict] = field(default_factory=list)
    pending_actions: list[dict] = field(default_factory=list)
    executed_actions: list[dict] = field(default_factory=list)

    def event(self, kind: str, **data) -> None:
        self.trace.append({"kind": kind, **data})


class Toolbox:
    def __init__(self, ws: Workspace, values: ValueStore, ctx: TurnCtx):
        self.ws = ws
        self.values = values
        self.ctx = ctx
        self.raw = ws.cfg.naive or not ws.cfg.reader_split
        # Naive mode has no quarantined reader: it never calls the model on untrusted text before acting.
        self.reader = QuarantinedReader(ws.router, ws.budget, use_model=not ws.cfg.naive)

    # ------------------------------------------------------------------ helpers
    def _read(self, raw: RawDoc) -> dict:
        return self._register(raw, self.reader.read(raw))

    def _register(self, raw: RawDoc, ro: ReaderOutput) -> dict:
        self.ws.db.insert("docs", {"id": raw.doc_id, "kind": raw.kind, "ref": raw.ref, "principal": raw.principal,
                                   "trust": raw.trust.value, "turn_id": self.ctx.turn_id,
                                   "raw": {"text": raw.text[:20000], "html": (raw.html or "")[:60000], "title": raw.title},
                                   "reader": ro.model_dump(exclude={"visible_text"}), "created_at": iso(self.ws.now())})
        self.ctx.docs.append(ro)
        view = self.values.register(ro, self.ctx.turn_id, raw_fields=self.raw)
        sid = view["handle"]
        text = ro.visible_text + ("\n" + "\n".join(h["text"] for h in ro.hidden) if ro.hidden else "")
        self.ctx.spans[sid] = Span(id=sid, kind=_kind(raw.kind), ref=raw.ref, principal=raw.principal, trust=raw.trust,
                                   text=text, flags=ro.flags,
                                   hidden_technique=ro.hidden[0]["technique"] if ro.hidden else None)
        self.ctx.event("read", handle=sid, doc_kind=raw.kind, ref=raw.ref, principal=raw.principal, trust=raw.trust.value,
                       flags=ro.flags, instructions=[i.model_dump() for i in ro.instructions], model=ro.model,
                       hidden=ro.hidden[:5])
        return view

    def _read_many(self, raws: list[RawDoc]) -> list[dict]:
        if len(raws) <= 1:
            return [self._read(r) for r in raws]
        with cf.ThreadPoolExecutor(max_workers=min(6, len(raws))) as ex:
            ros = list(ex.map(self.reader.read, raws))
        return [self._register(raw, ro) for raw, ro in zip(raws, ros, strict=True)]

    def _web_doc(self, url: str, title: str | None, text: str, html: str | None = None, kind: str = "web") -> RawDoc:
        dom = domain_of(url)
        return RawDoc(doc_id=new_id("doc"), kind=kind, ref=url, principal=f"domain:{dom}",
                      trust=self.ws.source_trust("web", f"domain:{registrable_domain(dom)}"), title=title, text=text,
                      html=html)

    # ------------------------------------------------------------------ tools
    def web_search(self, query: str, **_) -> Any:
        rs = self.ws.web.search(query, max_results=5, demo_only=self.ctx.demo_only)
        self.ctx.event("tavily", endpoint="search", query=query, results=[{"url": r.url, "source": r.source} for r in rs])
        return self._read_many([self._web_doc(r.url, r.title, r.content, kind="search_result") for r in rs])

    def web_extract(self, url: str, **_) -> Any:
        page = self.ws.web.extract(url)
        self.ctx.event("tavily", endpoint="extract", url=url, source=page.source)
        if not page.text and not page.html:
            return {"error": f"could not read {domain_of(url)}"}
        return self._read(self._web_doc(url, page.title, page.text, page.html))

    def deep_research(self, question: str, **_) -> Any:
        r = self.ws.web.research(question)
        self.ctx.event("tavily", endpoint="research" if not r.get("fallback") else "search", query=question,
                       sources=[s["url"] for s in r["sources"]])
        raws = []
        if r.get("content"):
            raws.append(RawDoc(doc_id=new_id("doc"), kind="research", ref="tavily:research", principal="tool:tavily-research",
                               trust=Trust.RED, title=f"Research: {question}", text=r["content"]))
        raws += [self._web_doc(s["url"], s.get("title"), s.get("content") or "", kind="search_result") for s in r["sources"][:6]]
        return self._read_many(raws)

    def learn_site(self, url: str, **_) -> Any:
        pages = self.ws.web.crawl(url, limit=8)
        self.ctx.event("tavily", endpoint="crawl", url=url, pages=[p.url for p in pages])
        return self._read_many([self._web_doc(p.url, p.title, p.text, p.html) for p in pages])

    def list_inbox(self, unread_only: bool = False, **_) -> Any:
        rows = self.ws.db.rows("SELECT * FROM emails ORDER BY date DESC")
        out = []
        for e in rows:
            if unread_only and not e["unread"]:
                continue
            trust = self.ws.source_trust("email", e["from_addr"])
            h = self.values.next_doc_handle()
            src = f"{'contact' if trust != Trust.RED else 'sender'}:{e['from_addr']}"
            self.values.put(Value(f"{h}.title", e["subject"], trust, "text", src, e["id"], h), self.ctx.turn_id)
            item = {"email_id": e["id"], "from": e["from_addr"], "trust": trust.value, "date": e["date"][:16],
                    "unread": bool(e["unread"]), "subject": f"{h}.title"}
            if self.raw:
                item["subject_text"] = e["subject"]
            out.append(item)
        return out

    def read_email(self, email_id: str, **_) -> Any:
        e = self.ws.db.row("SELECT * FROM emails WHERE id=?", (email_id,))
        if not e:
            return {"error": "no such email"}
        trust = self.ws.source_trust("email", e["from_addr"])
        principal = f"{'contact' if trust != Trust.RED else 'sender'}:{e['from_addr']}"
        self.ws.db.x("UPDATE emails SET unread=0 WHERE id=?", (email_id,))
        return self._read(RawDoc(doc_id=new_id("doc"), kind="email", ref=email_id, principal=principal, trust=trust,
                                 title=e["subject"], text=e["body"], html=e.get("html"), sender=e["from_addr"]))

    def send_email(self, to=None, cc=None, bcc=None, subject: str = "", body: str = "", attachments=None, **_) -> Any:
        oid = new_id("out")
        files = []
        for fid in _list(attachments):
            f = self.ws.db.row("SELECT id, name FROM files WHERE id=? OR name=?", (fid, fid))
            files.append(f["name"] if f else str(fid))
        self.ws.db.insert("outbox", {"id": oid, "to_addrs": _list(to), "cc": _list(cc), "bcc": _list(bcc),
                                     "subject": subject, "body": body, "attachments": files,
                                     "sent_at": iso(self.ws.now()), "turn_id": self.ctx.turn_id,
                                     "origin": self.ws.mode})
        return {"sent": True, "outbox_id": oid, "note": "delivered to the simulated Outbox (no real email is sent)"}

    def list_events(self, days: int = 7, **_) -> Any:
        rows = self.ws.db.rows("SELECT * FROM events ORDER BY start")
        now = self.ws.now()
        out = []
        for ev in rows:
            if ev["start"][:10] < iso(now)[:10] or ev["start"][:10] > iso(now.replace(hour=23) + _days(int(days or 7)))[:10]:
                continue
            item = {"id": ev["id"], "start": ev["start"], "end": ev["end"], "attendees": ev["attendees"], "trust": ev["trust"]}
            if ev["trust"] == "GREEN" or self.raw:
                item["title"] = ev["title"]
            else:
                h = self.values.next_doc_handle()
                self.values.put(Value(f"{h}.title", ev["title"], Trust(ev["trust"]), "text", ev["source"], ev["id"], h),
                                self.ctx.turn_id)
                item["title"] = f"{h}.title"
            out.append(item)
        return out

    def create_event(self, title: str = "", start: str = "", end: str = "", attendees=None, location: str = "",
                     notes: str = "", **_) -> Any:
        eid = new_id("evt")
        self.ws.db.insert("events", {"id": eid, "title": title, "start": start, "end": end or start,
                                     "attendees": _list(attendees), "location": location, "notes": notes,
                                     "source": "assistant", "trust": "GREEN", "created_at": iso(self.ws.now())})
        return {"created": True, "event_id": eid}

    def list_tasks(self, **_) -> Any:
        return [{"id": t["id"], "title": t["title"], "due": t["due"]}
                for t in self.ws.db.rows("SELECT * FROM tasks WHERE done=0 ORDER BY due")]

    def create_task(self, title: str = "", due: str = "", **_) -> Any:
        tid = new_id("tsk")
        self.ws.db.insert("tasks", {"id": tid, "title": title, "due": due, "done": 0, "source": "assistant",
                                    "trust": "GREEN", "created_at": iso(self.ws.now())})
        return {"created": True, "task_id": tid}

    def find_files(self, query: str = "", **_) -> Any:
        q = content_words(query)
        out = []
        for f in self.ws.db.rows("SELECT * FROM files"):
            if not q or q & content_words(f["name"] + " " + f["description"]):
                out.append({"file_id": f["id"], "name": f["name"], "description": f["description"]})
        return out

    def recall(self, query: str = "", **_) -> Any:
        statuses = {Status.active} if self.ws.cfg.naive else {Status.active, Status.claim, Status.corroborated_claim}
        hits = self.ws.store.recall(query, k=8, statuses=statuses)
        self.ctx.used_memories += [m.id for m, _ in hits]
        return [memory_view(m, self.raw) for m, _ in hits]

    def query_doc(self, handle: str = "", question: str = "", output: str = "text", **_) -> Any:
        base = handle.split(".")[0]
        v = self.values.get(handle) if "." in handle else None
        doc_ref = self.values.get(f"{base}._doc")
        text, principal, trust = "", "unknown", Trust.RED
        if v is not None and v.kind == "text":
            text, principal, trust = str(v.value), v.source, v.trust
        elif doc_ref is not None:
            d = self.ws.db.row("SELECT * FROM docs WHERE id=?", (doc_ref.value,))
            if d:
                raw = d["raw"] if isinstance(d["raw"], dict) else {}
                text = (raw.get("text") or "") + "\n" + (d["reader"].get("summary", "") if isinstance(d["reader"], dict) else "")
                if raw.get("html"):
                    from vouch.reader.detector import split_html

                    text = split_html(raw["html"]).visible
                principal, trust = d["principal"], Trust(d["trust"])
        if not text:
            return {"error": "unknown handle"}
        ans = self.reader.query(text, question, output, principal)
        if output in ("bool", "number") or (output == "enum" and isinstance(ans, str) and len(ans) <= 24):
            return {"answer": ans, "trust": trust.value, "note": "typed value from quarantined reader"}
        h = self.values.next_doc_handle()
        self.values.put(Value(f"{h}.answer", ans, trust, "text", principal, "query_doc", h), self.ctx.turn_id)
        return {"answer": f"{h}.answer", "trust": trust.value}

    def corroborate(self, memory_id: str = "", **_) -> Any:
        from vouch.gate.corroboration import corroborate

        m = self.ws.store.get(str(memory_id).lstrip("@"))
        if not m:
            return {"error": "unknown memory"}
        c = corroborate(self.ws, m, demo_only=self.ctx.demo_only)
        self.ctx.event("corroborate", memory_id=m.id, independent=c.independent_domains, upgraded=c.upgraded,
                       filtered=len(c.filtered), disputing=len(c.disputing))
        return {"memory_id": f"@{m.id}", "independent_supporting_domains": c.independent_domains,
                "disputing": len(c.disputing), "filtered_duplicates": len(c.filtered), "upgraded": c.upgraded,
                "status": m.status.value, "note": c.note}

    def run_skill(self, name: str = "", input: Any = None, **_) -> Any:
        from vouch.skills.manager import SkillManager

        res = SkillManager(self.ws).run(name, input or {})
        self.ctx.event("skill", name=name, ok=res.get("ok"), sandbox=res.get("sandbox"), blocked=res.get("blocked", []))
        if not res.get("ok"):
            return {"error": res.get("error", "skill failed"), "blocked": res.get("blocked", [])}
        return self._read(RawDoc(doc_id=new_id("doc"), kind="skill", ref=f"skill:{name}", principal=f"skill:{name}",
                                 trust=Trust.RED, title=f"Output of skill {name}", text=str(res.get("output", ""))[:20000]))

    def http_post(self, url: str = "", body: str = "", **_) -> Any:
        if self.ws.settings.hosted:
            return {"error": "http_post is disabled in the hosted demo (no real outbound effects)"}
        import httpx

        r = httpx.post(url, content=body.encode(), timeout=15)
        return {"status": r.status_code}

    def call(self, name: str, args: dict) -> Any:
        fn = getattr(self, name, None)
        if name not in SPEC_BY_NAME or fn is None:
            return {"error": f"unknown tool {name}"}
        return fn(**(args or {}))


def memory_view(m, raw: bool) -> dict:
    trusted = m.effective_trust == Trust.GREEN or (m.trust == Trust.YELLOW and m.status == Status.active)
    v = {"id": f"@{m.id}", "type": m.type.value, "trust": m.effective_trust.value, "status": m.status.value}
    if trusted or raw:
        v["content"] = m.content
    else:
        v["content"] = f"@{m.id}"
        v["source"] = m.source_label()
    return v


def _kind(k: str) -> str:
    return {"search_result": "web", "research": "tool", "web": "web", "email": "email", "skill": "skill"}.get(k, "tool")


def _list(v) -> list:
    if v is None or v == "":
        return []
    if isinstance(v, str):
        return [x.strip() for x in v.replace(";", ",").split(",") if x.strip()]
    return list(v)


def _days(n: int):
    from datetime import timedelta

    return timedelta(days=n)

