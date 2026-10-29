"""Runtime configuration. Everything comes from env vars (or a local .env file)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

PROVIDER_BASE_URLS = {
    "tokenfactory": "https://api.tokenfactory.nebius.com/v1/",
    "nvidia": "https://integrate.api.nvidia.com/v1",
}

# USD per 1M tokens (input, output). Matched by role, overridable via VOUCH_PRICES_JSON.
DEFAULT_PRICES = {
    "chat": (0.06, 0.24),
    "reader": (0.06, 0.24),
    "planner": (0.30, 0.90),
    "audit": (1.00, 3.00),
    "vl": (0.30, 0.90),
    "embed": (0.01, 0.0),
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    vouch_provider: Literal["tokenfactory", "nvidia", "mock"] = "tokenfactory"
    vouch_mode: Literal["local", "hosted"] = "local"

    token_factory_api_key: str = ""
    token_factory_base_url: str = PROVIDER_BASE_URLS["tokenfactory"]
    nvidia_api_key: str = ""
    nvidia_base_url: str = PROVIDER_BASE_URLS["nvidia"]
    tavily_api_key: str = ""

    # Per-role model overrides. Empty = auto-discover from GET /models.
    vouch_model_chat: str = ""
    vouch_model_reader: str = ""
    vouch_model_planner: str = ""
    vouch_model_audit: str = ""
    vouch_model_vl: str = ""
    vouch_model_embed: str = ""

    # How to switch Nemotron reasoning on/off. "chat_template_kwargs" sends
    # extra_body={"chat_template_kwargs": {"enable_thinking": bool}}; "none" sends nothing.
    vouch_thinking_param: Literal["chat_template_kwargs", "none"] = "chat_template_kwargs"
    vouch_json_mode: Literal["json_schema", "json_object", "prompt"] = "json_schema"
    vouch_prices_json: str = ""

    vouch_data_dir: Path = Path("data")
    vouch_public_url: str = ""  # e.g. https://<space>.hf.space — used to let Tavily extract demo pages
    vouch_demo_via_tavily: bool = False
    vouch_demo_web: bool = True  # serve the seeded attack/benign pages under /demo-sites

    # Credit protection (hosted demo). 0 = unlimited.
    vouch_session_token_cap: int = 400_000
    vouch_session_tavily_cap: int = 40
    vouch_global_daily_usd_cap: float = 8.0
    vouch_session_ttl_hours: int = 24

    vouch_llm_timeout: float = 90.0
    vouch_llm_max_retries: int = 3

    vouch_sandbox: Literal["auto", "openshell", "subprocess"] = "auto"
    vouch_briefing_hour: int = 7
    vouch_audit_hour: int = 2

    @property
    def hosted(self) -> bool:
        return self.vouch_mode == "hosted"

    @property
    def mock(self) -> bool:
        return self.vouch_provider == "mock"

    def provider_creds(self) -> tuple[str, str]:
        if self.vouch_provider == "nvidia":
            return self.nvidia_base_url, self.nvidia_api_key
        return self.token_factory_base_url, self.token_factory_api_key


@lru_cache
def get_settings() -> Settings:
    return Settings()
