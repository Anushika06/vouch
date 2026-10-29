"""One-time approval codes: shown only in the Vouch UI, required by the MCP `approve` tool."""

from __future__ import annotations

import hashlib
import hmac
from pathlib import Path


def approval_code(ws_root: Path, mem_id: str) -> str:
    key = (Path(ws_root) / "vault.key").read_bytes()
    return hmac.new(key, f"approve:{mem_id}".encode(), hashlib.sha256).hexdigest()[:6]
