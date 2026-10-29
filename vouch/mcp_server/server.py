"""vouch-mcp: Vouch's provenance-first memory as an MCP server (stdio), so any personal agent —
Hermes Agent, OpenClaw, NemoClaw — can use it as its long-term memory.

Tools: remember, recall, why, pending_approvals, approve, reject.

Trust for writes comes from the declared source, and a declaration can only *lower* trust: an agent
relaying "the user said X" is YELLOW (not GREEN, because the agent itself may have read untrusted text),
web/tool/skill content is RED. Approving a pending memory is a human decision: `approve` requires a
one-time confirmation code that is shown only in the Vouch UI, so an injected agent cannot approve its
own poisoned write.
"""

from __future__ import annotations

import hmac
import os
from pathlib import Path

try:  # mcp >= 2
    from mcp.server.mcpserver import MCPServer as FastMCP
except ImportError:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP

from vouch.config import get_settings
from vouch.llm.router import get_router
from vouch.mcp_server.codes import approval_code
from vouch.models import Candidate, Span, Status, Trust
from vouch.util import domain_of, new_id
from vouch.web.tavily import TavilyCache
from vouch.workspace import AgentConfig, Workspace

mcp = FastMCP("vouch")
_ws: Workspace | None = None


def workspace() -> Workspace:
    global _ws
    if _ws is None:
        s = get_settings()
        sid = os.environ.get("VOUCH_LOCAL_SESSION", "local-user")
        root = Path(s.vouch_data_dir) / "sessions" / sid / "vouch"
        _ws = Workspace(root, s, get_router(s), TavilyCache(Path(s.vouch_data_dir) / "tavily-cache.db"), AgentConfig())
        if not _ws.is_seeded() and os.environ.get("VOUCH_MCP_SEED", "") == "asha":
            _ws.seed()
    return _ws


def _span(ws: Workspace, content: str, source_kind: str, source_ref: str, principal: str) -> Span:
    kind = source_kind.lower()
    if kind in ("user", "user_chat"):
        return Span(id="S", kind="agent", ref=source_ref or "mcp", principal=principal or "agent:relayed-user",
                    trust=Trust.YELLOW, text=content)
    if kind == "email":
        p = principal or f"sender:{source_ref}"
        return Span(id="S", kind="email", ref=source_ref, principal=p, trust=ws.source_trust("email", p), text=content)
    if kind == "web":
        p = principal or f"domain:{domain_of(source_ref)}"
        return Span(id="S", kind="web", ref=source_ref, principal=p, trust=ws.source_trust("web", p), text=content)
    return Span(id="S", kind="tool" if kind != "skill" else "skill", ref=source_ref or kind,
                principal=principal or f"{kind}:{source_ref or 'unknown'}", trust=Trust.RED, text=content)


def _view(m) -> dict:
    trusted = m.effective_trust == Trust.GREEN or (m.trust == Trust.YELLOW and m.status == Status.active)
    p = m.provenance[0] if m.provenance else None
    return {"id": m.id, "type": m.type.value, "trust": m.effective_trust.value, "status": m.status.value,
            "content": m.content if trusted else f"[untrusted claim from {m.source_label()} — content withheld]",
            "source": p.principal if p else None}


@mcp.tool()
def remember(content: str, source_kind: str = "user", source_ref: str = "", principal: str = "") -> dict:
    """Propose a memory. source_kind: user | email | web | tool | skill. The Trust Gate decides whether it
    is saved, kept as a claim, queued for the user's approval, or blocked."""
    ws = workspace()
    span = _span(ws, content, source_kind, source_ref or new_id("mcp"), principal)
    ev = ws.gate.process([Candidate(content=content[:1000], span_ids=["S"], origin="mcp")], {"S": span}, "mcp-client")
    if not ev:
        return {"saved": False}
    m = ev[0].memory
    return {"id": m.id, "status": m.status.value, "trust": m.trust.value, "type": m.type.value,
            "gate": ev[0].action, "reason": m.gate_decision.reason if m.gate_decision else ""}


@mcp.tool()
def recall(query: str, k: int = 8) -> list[dict]:
    """Search memory. Untrusted claims are returned without their content (handles only), so a poisoned
    claim cannot instruct the calling agent."""
    ws = workspace()
    return [_view(m) | {"score": s} for m, s in ws.store.recall(query, k=k)]


@mcp.tool()
def why(memory_id: str) -> dict:
    """Why do you believe this? Provenance, gate decision and the git history of one memory."""
    ws = workspace()
    m = ws.store.get(memory_id)
    if not m:
        return {"error": "unknown memory"}
    return {"memory": _view(m), "provenance": [p.model_dump(exclude={"excerpt"}) for p in m.provenance],
            "gate": m.gate_decision.model_dump() if m.gate_decision else None,
            "history": [{"sha": h["sha"][:10], "time": h["time"], "title": h["title"]} for h in ws.store.history(memory_id)]}


@mcp.tool()
def pending_approvals() -> list[dict]:
    """Memory writes waiting for the user's decision."""
    ws = workspace()
    return [_view(m) | {"reason": m.gate_decision.reason if m.gate_decision else "",
                        "flags": m.gate_decision.detector_flags if m.gate_decision else [],
                        "suggestion": m.gate_decision.suggestion if m.gate_decision else None}
            for m in ws.store.list(status=Status.pending_approval.value)]


@mcp.tool()
def approve(memory_id: str, confirmation_code: str = "") -> dict:
    """Approve a pending memory. Requires the 6-character code shown to the user in the Vouch UI
    (Approval Inbox). Ask the user for it — never guess it."""
    ws = workspace()
    if not hmac.compare_digest(confirmation_code.strip().lower(), approval_code(ws.root, memory_id)):
        return {"approved": False, "error": "approval needs the confirmation code from the Vouch UI; ask the user"}
    m = ws.gate.approve(memory_id)
    return {"approved": bool(m), "status": m.status.value if m else None}


@mcp.tool()
def reject(memory_id: str) -> dict:
    """Reject a pending memory (always allowed: rejecting can only make memory safer)."""
    m = workspace().gate.reject(memory_id)
    return {"rejected": bool(m)}


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
