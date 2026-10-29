import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("VOUCH_PROVIDER", "mock")
os.environ["TAVILY_API_KEY"] = ""

from vouch.config import Settings  # noqa: E402
from vouch.llm.router import Router  # noqa: E402
from vouch.web.tavily import TavilyCache  # noqa: E402
from vouch.workspace import AgentConfig, Workspace  # noqa: E402


@pytest.fixture(scope="session")
def settings():
    return Settings(vouch_provider="mock", tavily_api_key="")


@pytest.fixture(scope="session")
def router(settings):
    r = Router(settings)
    r.discover()
    return r


@pytest.fixture
def make_ws(tmp_path, settings, router):
    cache = TavilyCache(tmp_path / "cache.db")
    made = []

    def _make(config: str = "vouch-full", attacks: bool = False) -> Workspace:
        ws = Workspace(tmp_path / f"{config}-{len(made)}", settings, router, cache, AgentConfig.named(config))
        ws.seed(include_attacks=attacks)
        made.append(ws)
        return ws

    yield _make
    for ws in made:
        ws.close()
