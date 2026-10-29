"""Interpreter: resolves handles at execution time, taint-checks side-effecting calls, and pauses
tainted ones for the user's confirmation."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from vouch.interpreter import taint
from vouch.interpreter.values import Value, ValueStore
from vouch.models import Status, Trust
from vouch.tools.toolbox import SPEC_BY_NAME, Toolbox, TurnCtx
from vouch.util import EMAIL_RE, iso, new_id

if TYPE_CHECKING:
    from vouch.workspace import Workspace

log = logging.getLogger("vouch.interpreter")

ID_ARGS = ("memory_id", "handle", "email_id")


def mem_lookup_for(ws: Workspace, ctx: TurnCtx | None = None):
    def lookup(mem_id: str) -> Value | None:
        m = ws.store.get(mem_id)
        if not m:
            return None
        if ctx is not None:
            ctx.used_memories.append(m.id)
        return Value(f"@{m.id}", m.content, m.effective_trust, "text", m.source_label(), m.id, m.id)

    return lookup


def grounding_context(ws: Workspace, ctx: TurnCtx) -> taint.GroundingContext:
    green = [ctx.user_text]
    green += [t["content"] for t in ws.db.rows("SELECT content FROM turns WHERE role='user' ORDER BY created_at DESC LIMIT 20")]
    untrusted: list[tuple[str, str, Trust]] = []
    for m in ws.store.all():
        if m.status == Status.active and m.effective_trust == Trust.GREEN:
            green.append(m.content)
        else:
            untrusted.append((m.source_label(), m.content, m.effective_trust))
    for d in ws.db.rows("SELECT principal, trust, raw FROM docs"):
        raw = d["raw"] if isinstance(d["raw"], dict) else {}
        txt = (raw.get("text") or "") + "\n" + (raw.get("html") or "")
        untrusted.append((d["principal"], txt, Trust(d["trust"])))
    for sp in ctx.spans.values():
        if sp.trust != Trust.GREEN:
            untrusted.append((sp.principal, sp.text, sp.trust))
    for e in ws.db.rows("SELECT from_addr, body FROM emails"):
        untrusted.append((f"sender:{e['from_addr']}", e["body"] or "", ws.source_trust("email", e["from_addr"])))
    ts = ws.trust_settings()
    return taint.GroundingContext(green, untrusted, trusted_addresses=ts.trusted_contacts | ts.own_accounts)


class Interpreter:
    def __init__(self, ws: Workspace, values: ValueStore, toolbox: Toolbox, ctx: TurnCtx):
        self.ws = ws
        self.values = values
        self.tb = toolbox
        self.ctx = ctx
        self.check_taint = ws.cfg.taint and not ws.cfg.naive
        self.lookup = mem_lookup_for(ws, ctx)

    def execute(self, steps: list[dict], round_no: int) -> list[dict]:
        obs = []
        for i, step in enumerate(steps):
            tool, args = step.get("tool"), step.get("args") or {}
            sid = f"r{round_no}.{i}"
            spec = SPEC_BY_NAME.get(tool)
            if spec is None:
                obs.append({"step": sid, "tool": tool, "error": "unknown tool"})
                continue
            # Identifier args (memory ids, doc handles for query_doc) are passed through unresolved.
            keep = {k: args[k] for k in ID_ARGS if k in args}
            resolved, used = self.values.resolve({k: v for k, v in args.items() if k not in keep}, self.lookup)
            resolved.update(keep)
            if spec.get("side_effect"):
                if self.check_taint:
                    mem_trust = {}
                    for v in used:
                        if v.handle.startswith("@mem_"):
                            m = self.ws.store.get(v.handle[1:])
                            if m:
                                mem_trust[m.id] = (m.trust, m.approved_by_user)
                    items = taint.check(tool, args, resolved, used, mem_trust, grounding_context(self.ws, self.ctx))
                    if items:
                        pa = self._pause(tool, args, resolved, items)
                        obs.append({"step": sid, "tool": tool, "status": "paused_for_user_confirmation",
                                    "pending_action_id": pa["id"],
                                    "tainted": [{"arg": t.arg, "value": t.value, "source": t.source} for t in items]})
                        continue
                result = _safe_call(self.tb, tool, resolved)
                self.ctx.executed_actions.append({"tool": tool, "args": resolved, "result": result})
                self.ctx.event("action", step=sid, tool=tool, args=resolved, result=result)
            else:
                result = _safe_call(self.tb, tool, resolved)
                self.ctx.event("tool", step=sid, tool=tool, args=args)
            obs.append({"step": sid, "tool": tool, "args": args, "result": result})
        return obs

    def _pause(self, tool: str, raw_args: dict, resolved: dict, items: list[taint.TaintItem]) -> dict:
        pa = {"id": new_id("act"), "turn_id": self.ctx.turn_id, "tool": tool, "args": resolved,
              "taint": [t.as_dict() for t in items], "status": "pending", "result": None,
              "created_at": iso(self.ws.now()), "resolved_at": None}
        self.ws.db.insert("pending_actions", pa)
        self.ctx.pending_actions.append(pa)
        self.ctx.event("taint", tool=tool, args=resolved, tainted=[t.as_dict() for t in items], pending_action_id=pa["id"])
        return pa


def _safe_call(tb: Toolbox, tool: str, args: dict) -> Any:
    from vouch.llm.router import BudgetExceeded
    from vouch.web.tavily import WebLimit

    try:
        return tb.call(tool, args)
    except (BudgetExceeded, WebLimit):
        raise
    except Exception as e:  # tool errors are observations, not crashes
        log.exception("tool %s failed", tool)
        return {"error": f"{type(e).__name__}: {e}"}


def resolve_pending(ws: Workspace, action_id: str, decision: str) -> dict:
    """decision: approve | approve_clean (drop tainted recipients) | reject. A user click is GREEN."""
    pa = ws.db.row("SELECT * FROM pending_actions WHERE id=?", (action_id,))
    if not pa or pa["status"] != "pending":
        return {"error": "no such pending action"}
    if decision == "reject":
        ws.db.x("UPDATE pending_actions SET status='rejected', resolved_at=? WHERE id=?", (iso(ws.now()), action_id))
        return {"status": "rejected"}
    args = dict(pa["args"])
    if decision == "approve_clean":
        bad = {t["value"].lower() for t in pa["taint"]}
        for k in ("to", "cc", "bcc", "attendees"):
            if k in args:
                vals = args[k] if isinstance(args[k], list) else [args[k]]
                args[k] = [v for v in vals if not (set(e.lower() for e in EMAIL_RE.findall(str(v))) & bad) and str(v).lower() not in bad]
        if not args.get("to") and pa["tool"] == "send_email":
            return {"error": "nothing left to send after removing tainted recipients"}
    ctx = TurnCtx(turn_id=pa["turn_id"], user_text="(approved in UI)")
    tb = Toolbox(ws, ValueStore(ws.db, ws.now), ctx)
    result = _safe_call(tb, pa["tool"], args)
    ws.db.x("UPDATE pending_actions SET status=?, result=?, resolved_at=?, args=? WHERE id=?",
            ("executed", _json(result), iso(ws.now()), _json(args), action_id))
    return {"status": "executed", "result": result, "args": args}


def _json(o) -> str:
    import json

    return json.dumps(o, default=str)
