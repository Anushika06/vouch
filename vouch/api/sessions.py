"""Per-visitor isolation: each anonymous session gets its own workspaces (Shield ON = vouch, Shield OFF =
naive), seeded with the demo persona. Hosted sessions are purged after VOUCH_SESSION_TTL_HOURS."""

from __future__ import annotations

import re
import shutil
import threading
import time
from pathlib import Path

from vouch.config import Settings
from vouch.llm.router import Router
from vouch.web.tavily import TavilyCache
from vouch.workspace import AgentConfig, Workspace

_SID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


class SessionManager:
    def __init__(self, settings: Settings, router: Router):
        self.s = settings
        self.router = router
        self.base = Path(settings.vouch_data_dir) / "sessions"
        self.base.mkdir(parents=True, exist_ok=True)
        self.cache = TavilyCache(Path(settings.vouch_data_dir) / "tavily-cache.db")
        self._open: dict[tuple[str, str], Workspace] = {}
        self._seen: dict[str, float] = {}
        self.lock = threading.RLock()

    @staticmethod
    def valid(sid: str | None) -> bool:
        return bool(sid and _SID.match(sid))

    def get(self, sid: str, mode: str = "vouch") -> Workspace:
        if not self.valid(sid):
            raise ValueError("invalid session id")
        key = (sid, mode)
        with self.lock:
            self._seen[sid] = time.time()
            ws = self._open.get(key)
            if ws is None:
                cfg = AgentConfig.named("naive" if mode == "naive" else "vouch-full")
                ws = Workspace(self.base / sid / mode, self.s, self.router, self.cache, cfg)
                if not ws.is_seeded():
                    ws.seed()
                self._open[key] = ws
            return ws

    def lab(self, sid: str, run_id: str, mode: str) -> Workspace:
        cfg = AgentConfig.named("naive" if mode == "naive" else "vouch-full")
        ws = Workspace(self.base / sid / "lab" / run_id / mode, self.s, self.router, self.cache, cfg)
        ws.seed(include_attacks=False)
        return ws

    def prune_labs(self, sid: str, keep: int = 3) -> None:
        d = self.base / sid / "lab"
        if not d.exists():
            return
        runs = sorted(d.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in runs[keep:]:
            shutil.rmtree(old, ignore_errors=True)

    def reset(self, sid: str) -> None:
        with self.lock:
            for mode in ("vouch", "naive"):
                ws = self._open.pop((sid, mode), None)
                if ws:
                    ws.close()
            shutil.rmtree(self.base / sid, ignore_errors=True)

    def active_sessions(self, within_hours: float = 24) -> list[str]:
        cutoff = time.time() - within_hours * 3600
        return [sid for sid, t in self._seen.items() if t >= cutoff]

    def purge(self) -> int:
        ttl = self.s.vouch_session_ttl_hours * 3600
        n = 0
        for d in list(self.base.iterdir()):
            last = self._seen.get(d.name, d.stat().st_mtime)
            if time.time() - last > ttl:
                self.reset(d.name)
                n += 1
        return n
