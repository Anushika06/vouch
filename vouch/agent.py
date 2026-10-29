"""One assistant turn, end to end.

Vouch: route (Lightning) → plan over handles (Super) → interpreter with taint check → render →
memory writer (Lightning) → Trust Gate → git ledger.
Naive baseline: one model sees everything raw, acts directly, and saves every memory as active.
"""

from __future__ import annotations

from typing import Any

from vouch.interpreter.interpreter import Interpreter, mem_lookup_for
from vouch.interpreter.values import ValueStore
from vouch.memory.writer import MemoryWriter, detector_candidates
from vouch.models import RECALLABLE, GateAction, GateDecision, MemType, Memory, Provenance, Span, Status, Trust
from vouch.tools.toolbox import Toolbox, TurnCtx, memory_view
from vouch.util import iso, new_id
from vouch.workspace import Workspace

MAX_ROUNDS = 4


class Agent:
    def __init__(self, ws: Workspace):
        self.ws = ws
        persona = ws.db.get_setting("persona", {}) or {}
        self.persona = persona.get("name", "the user")

    def turn(self, text: str, demo_only: bool = False) -> dict[str, Any]:
        with self.ws.lock:
            return self._turn(text, demo_only)

    def _turn(self, text: str, demo_only: bool) -> dict[str, Any]:
        from vouch.planner.planner import Planner

        ws = self.ws
        naive = ws.cfg.naive
        turn_id = new_id("turn")
        ctx = TurnCtx(turn_id=turn_id, user_text=text, demo_only=demo_only)
        history = self._history()
        ws.db.insert("turns", {"id": turn_id, "role": "user", "content": text, "meta": {"mode": ws.mode},
                               "created_at": iso(ws.now())})
        ctx.spans["U"] = Span(id="U", kind="user_chat", ref=turn_id, principal="user", trust=Trust.GREEN, text=text)
        values = ValueStore(ws.db, ws.now)
        tb = Toolbox(ws, values, ctx)
        interp = Interpreter(ws, values, tb, ctx)
        lookup = mem_lookup_for(ws, ctx)

        contacts = [memory_view(m, True) for m in ws.store.contacts(require_trusted=not naive)]
        rules = [memory_view(m, True) for m in ws.store.standing_rules(require_trusted=not naive)]
        pinned = {c["id"] for c in contacts} | {r["id"] for r in rules}
        recalled = ws.store.recall(text, k=8, statuses={Status.active} if naive else RECALLABLE)
        memories = [memory_view(m, raw=naive) for m, _ in recalled if f"@{m.id}" not in pinned]
        ctx.used_memories += [x["id"][1:] for x in contacts + rules + memories]
        ctx.event("recall", contacts=len(contacts), rules=[r["content"] for r in rules],
                  memories=[{"id": m["id"], "trust": m["trust"], "status": m["status"]} for m in memories])

        planner = Planner(ws.router, ws.budget, naive, self.persona, ws.now())
        answer: str | None = None
        if not naive:
            r = planner.route(text, contacts, rules, memories, history)
            ctx.event("route", needs_tools=bool(r.get("needs_tools", True)), model=ws.router.models.get("chat"))
            if not r.get("needs_tools", True) and r.get("answer"):
                answer = str(r["answer"])

        observations: list[dict] = []
        rnd = 0
        while answer is None and rnd < MAX_ROUNDS:
            plan, model = planner.plan(text, contacts, rules, memories, history, observations, rnd)
            ctx.event("plan", round=rnd, thought=plan["thought"], steps=plan["steps"], model=model,
                      final=plan["answer"] is not None)
            observations += interp.execute(plan["steps"], rnd)
            if plan["answer"]:
                answer = str(plan["answer"])
                break
            if not plan["steps"]:
                break
            rnd += 1
        if answer is None:
            answer = "I couldn't finish that within my step budget. Here is what I found so far."
        if ctx.pending_actions:
            n = len(ctx.pending_actions)
            answer += (f"\n\n⏸ I paused {n} action{'s' if n > 1 else ''} because part of it came from a source you "
                       "haven't approved. Review the card below before anything is sent.")

        segments = values.render(answer, lookup) if not naive else [{"text": answer, "trust": None}]
        memory_events = self._write_memories(ctx)
        ws.store.mark_used(ctx.used_memories, turn_id)

        result = {
            "turn_id": turn_id, "mode": ws.mode, "config": ws.cfg.label(), "user": text, "answer": answer,
            "segments": segments, "trace": ctx.trace, "memory_events": memory_events,
            "pending_actions": ctx.pending_actions, "executed_actions": ctx.executed_actions,
            "used_memories": list(dict.fromkeys(ctx.used_memories)), "created_at": iso(ws.now()),
        }
        ws.db.insert("turns", {"id": turn_id + "_a", "role": "assistant", "content": answer,
                               "meta": {k: v for k, v in result.items() if k not in ("user", "answer")},
                               "created_at": iso(ws.now())})
        return result

    def read_email(self, email_id: str) -> dict[str, Any]:
        """Inbox "Read with Vouch": one email through the quarantined reader and the memory pipeline."""
        with self.ws.lock:
            ws = self.ws
            e = ws.db.row("SELECT subject, from_addr FROM emails WHERE id=?", (email_id,))
            if not e:
                return {"error": "unknown email"}
            turn_id = new_id("turn")
            text = f"Read the email from {e['from_addr']}: “{e['subject']}”"
            ctx = TurnCtx(turn_id=turn_id, user_text=text)
            ctx.spans["U"] = Span(id="U", kind="user_chat", ref=turn_id, principal="user", trust=Trust.GREEN, text=text)
            ws.db.insert("turns", {"id": turn_id, "role": "user", "content": text, "meta": {"mode": ws.mode},
                                   "created_at": iso(ws.now())})
            values = ValueStore(ws.db, ws.now)
            view = Toolbox(ws, values, ctx).read_email(email_id)
            answer = (f"Summary of the email from {e['from_addr']}: " + "{{" + view["summary"] + "}}"
                      if "summary" in view else f"Email from {e['from_addr']}: {view.get('summary_text', '')}")
            if view.get("instructions_detected"):
                answer += ("\n\n⚠ This email contains text addressed to an AI assistant. I did not act on it."
                           if not ws.cfg.naive else "")
            segments = values.render(answer, mem_lookup_for(ws, ctx)) if not ws.cfg.naive else [{"text": answer, "trust": None}]
            memory_events = self._write_memories(ctx)
            result = {"turn_id": turn_id, "mode": ws.mode, "config": ws.cfg.label(), "user": text, "answer": answer,
                      "segments": segments, "trace": ctx.trace, "memory_events": memory_events, "pending_actions": [],
                      "executed_actions": [], "used_memories": [], "created_at": iso(ws.now())}
            ws.db.insert("turns", {"id": turn_id + "_a", "role": "assistant", "content": answer,
                                   "meta": {k: v for k, v in result.items() if k not in ("user", "answer")},
                                   "created_at": iso(ws.now())})
            return result

    def _history(self, n: int = 6) -> list[dict]:
        rows = self.ws.db.rows("SELECT role, content FROM turns ORDER BY created_at DESC LIMIT ?", (n,))
        # Vouch replays its own answer *templates* (handles intact), so untrusted text never re-enters the planner.
        return [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]

    def _write_memories(self, ctx: TurnCtx) -> list[dict]:
        ws = self.ws
        writer = MemoryWriter(ws.router, ws.budget, self.persona)
        existing = [{"id": m.id, "content": m.content} for m in ws.store.all({Status.active})][-30:]
        if ws.cfg.naive:
            raw = [(ro.principal, ro.visible_text + "\n" + "\n".join(h["text"] for h in ro.hidden)) for ro in ctx.docs]
            cands, model = writer.propose_naive(ctx.user_text, raw, existing)
            events = []
            known = {e["content"].strip().lower() for e in existing}
            for c in cands:
                if c.content.strip().lower() in known:
                    continue
                m = Memory(type=c.type or MemType.FACT, content=c.content, status=Status.active, trust=Trust.GREEN,
                           provenance=[Provenance(kind="system", ref=ctx.turn_id, principal="assistant",
                                                  trust=Trust.GREEN, excerpt=c.content)],
                           created_by_model=model,
                           gate_decision=GateDecision(action=GateAction.auto_save, reason="naive memory: saves everything"),
                           created_at=iso(ws.now()))
                ws.store.save(m, "naive:save", "assistant")
                events.append({"memory": m.model_dump(), "action": "auto_save", "notes": []})
            return events
        cands, model = writer.propose(ctx.user_text, ctx.docs, ctx.spans, existing)
        cands += detector_candidates(ctx.docs, ctx.spans)
        return [e.as_dict() for e in ws.gate.process(cands, ctx.spans, model)]
