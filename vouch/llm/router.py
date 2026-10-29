"""Token Factory client with per-role model routing.

One function per role, retries with backoff, JSON validation + repair, token/cost accounting per
call, and a per-session budget cap. The same code path serves Nebius Token Factory (default) and
NVIDIA build.nvidia.com (local dev only); both are OpenAI-compatible.
"""

from __future__ import annotations

import json
import logging
import random
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from vouch.config import DEFAULT_PRICES, Settings

log = logging.getLogger("vouch.llm")

ROLES = ("chat", "reader", "planner", "audit", "vl", "embed")

# Compact (lowercase, alphanumerics only) substrings, tried in order. First pattern list that matches wins.
ROLE_PATTERNS: dict[str, list[list[str]]] = {
    "chat": [["nemotron35lightning"], ["lightning"]],
    "reader": [["nemotron3nano30b"], ["nemotron3nano"], ["nemotronnano"]],
    "planner": [["nemotron3super120b"], ["super120b"], ["nemotron3super"], ["nemotronsuper"]],
    "audit": [["nemotron3ultra"], ["ultra550b"], ["nemotronultra"]],
    "vl": [["nemotron35supervl"], ["supervl"], ["nemotron", "vl"]],
    "embed": [["qwen3embedding8b"], ["qwen3embedding"], ["embedding"]],
}
ROLE_EXCLUDE = {
    "chat": ["vl", "embed"],
    "reader": ["vl", "embed"],
    "planner": ["vl", "embed"],
    "audit": ["vl", "embed"],
    "vl": ["embed"],
    "embed": [],
}
ROLE_FALLBACK = {"chat": "reader", "audit": "planner", "planner": "chat", "reader": "chat"}


class BudgetExceeded(Exception):
    pass


class LLMError(Exception):
    pass


@dataclass
class LLMResult:
    text: str
    data: Any
    role: str
    task: str
    model: str
    tokens_in: int
    tokens_out: int
    cost: float
    latency_ms: int
    mock: bool = False


@dataclass
class Budget:
    """Per-session spend tracker. `sink` persists each call (the workspace usage table)."""

    token_cap: int = 0
    tokens_used: int = 0
    cost_used: float = 0.0
    calls: int = 0
    sink: Callable[[LLMResult], None] | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)

    def check(self) -> None:
        if self.token_cap and self.tokens_used >= self.token_cap:
            raise BudgetExceeded("demo limit reached for this session — clone the repo to run your own Vouch")

    def add(self, r: LLMResult) -> None:
        with self.lock:
            self.tokens_used += r.tokens_in + r.tokens_out
            self.cost_used += r.cost
            self.calls += 1
        if self.sink:
            try:
                self.sink(r)
            except Exception:  # accounting must never break a turn
                log.exception("usage sink failed")


def _compact(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def resolve_models(available: list[str]) -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    comp = {m: _compact(m) for m in available}
    for role in ROLES:
        chosen = None
        for pattern in ROLE_PATTERNS[role]:
            hits = [
                m
                for m, c in comp.items()
                if all(p in c for p in pattern) and not any(x in c for x in ROLE_EXCLUDE[role])
            ]
            if hits:
                # Prefer ids from the nvidia namespace, then the shortest (base, non-variant) id.
                hits.sort(key=lambda m: (0 if "nvidia" in m.lower() else 1, len(m)))
                chosen = hits[0]
                break
        out[role] = chosen
    return out


_THINK = re.compile(r"<think>.*?</think>", re.S)


def extract_json(text: str) -> Any:
    t = _THINK.sub("", text).strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t, flags=re.M).strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        pass
    start = min([i for i in (t.find("{"), t.find("[")) if i >= 0], default=-1)
    if start < 0:
        raise ValueError("no JSON object found")
    opener = t[start]
    closer = "}" if opener == "{" else "]"
    depth, in_str, esc = 0, False, False
    for i in range(start, len(t)):
        ch = t[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return json.loads(t[start : i + 1])
    raise ValueError("unterminated JSON")


def _check_schema(data: Any, schema: dict) -> None:
    """Light validation: top-level type and required keys. Enough to trigger a repair round."""
    if schema.get("type") == "object":
        if not isinstance(data, dict):
            raise ValueError("expected a JSON object")
        missing = [k for k in schema.get("required", []) if k not in data]
        if missing:
            raise ValueError(f"missing required keys: {missing}")


class Router:
    def __init__(self, settings: Settings):
        self.s = settings
        self.models: dict[str, str | None] = {}
        self.available: list[str] = []
        self._client = None
        self._json_mode: dict[str, str] = {}
        self._daily = {"day": date.today().isoformat(), "usd": 0.0}
        self._daily_lock = threading.Lock()
        prices = dict(DEFAULT_PRICES)
        if settings.vouch_prices_json:
            prices.update({k: tuple(v) for k, v in json.loads(settings.vouch_prices_json).items()})
        self.prices = prices
        # Provider diagnostics (JSON repairs, structured-output fallbacks, retries) feed FEEDBACK.md.
        self.stats: dict[str, dict[str, int]] = {}

    def _stat(self, model: str, key: str) -> None:
        with self._daily_lock:
            d = self.stats.setdefault(model, {})
            d[key] = d.get(key, 0) + 1

    # ---------------------------------------------------------------- discovery
    @property
    def client(self):
        if self._client is None:
            from openai import OpenAI

            base_url, key = self.s.provider_creds()
            self._client = OpenAI(base_url=base_url, api_key=key or "missing", timeout=self.s.vouch_llm_timeout, max_retries=0)
        return self._client

    def discover(self) -> dict[str, str | None]:
        overrides = {
            "chat": self.s.vouch_model_chat,
            "reader": self.s.vouch_model_reader,
            "planner": self.s.vouch_model_planner,
            "audit": self.s.vouch_model_audit,
            "vl": self.s.vouch_model_vl,
            "embed": self.s.vouch_model_embed,
        }
        if self.s.mock:
            self.models = {r: overrides[r] or f"mock-{r}" for r in ROLES}
            return self.models
        try:
            self.available = sorted(m.id for m in self.client.models.list().data)
        except Exception as e:  # keep serving with overrides only; healthz reports it
            log.error("model discovery failed: %s", e)
            self.available = []
        resolved = resolve_models(self.available)
        for role in ROLES:
            if overrides[role]:
                resolved[role] = overrides[role]
        for role, fb in ROLE_FALLBACK.items():
            if not resolved.get(role) and resolved.get(fb):
                log.warning("no model for role %s; falling back to %s (%s)", role, fb, resolved[fb])
                resolved[role] = resolved[fb]
        self.models = resolved
        log.info("resolved models (%s): %s", self.s.vouch_provider, resolved)
        return resolved

    def model_for(self, role: str) -> str:
        if not self.models:
            self.discover()
        m = self.models.get(role)
        if not m:
            raise LLMError(f"no model resolved for role '{role}' on provider {self.s.vouch_provider}")
        return m

    # ---------------------------------------------------------------- accounting
    def _price(self, role: str, tin: int, tout: int) -> float:
        pin, pout = self.prices.get(role, (0.3, 0.9))
        return (tin * pin + tout * pout) / 1_000_000

    def _charge_daily(self, usd: float) -> None:
        with self._daily_lock:
            today = date.today().isoformat()
            if self._daily["day"] != today:
                self._daily = {"day": today, "usd": 0.0}
            self._daily["usd"] += usd

    def check_daily(self) -> None:
        cap = self.s.vouch_global_daily_usd_cap
        if self.s.hosted and cap and self._daily["usd"] >= cap:
            raise BudgetExceeded("the hosted demo hit today's global spend cap — clone the repo to run your own")

    @property
    def daily_usd(self) -> float:
        return self._daily["usd"]

    # ---------------------------------------------------------------- calls
    def complete(
        self,
        role: str,
        messages: list[dict],
        *,
        task: str,
        schema: dict | None = None,
        thinking: bool = False,
        max_tokens: int = 1200,
        temperature: float = 0.2,
        mock_input: dict | None = None,
        budget: Budget | None = None,
        seed: int | None = 7,
    ) -> LLMResult:
        if budget:
            budget.check()
        self.check_daily()
        t0 = time.perf_counter()
        replayed = self._replay(task, messages) if self.s.mock else None
        if replayed is not None:
            data = extract_json(replayed) if schema else replayed
            res = LLMResult(replayed, data if schema else None, role, task, self.model_for(role) + " (replay)",
                            0, 0, 0.0, 0, mock=True)
            if budget:
                budget.add(res)
            return res
        if self.s.mock:
            from vouch.llm import mock

            data = mock.handle(task, mock_input or {}, messages)
            text = data if isinstance(data, str) else json.dumps(data)
            tin = sum(len(m.get("content") or "") for m in messages) // 4
            res = LLMResult(text, None if isinstance(data, str) else data, role, task, self.model_for(role),
                            tin, len(text) // 4, 0.0, int((time.perf_counter() - t0) * 1000), mock=True)
            if budget:
                budget.add(res)
            return res

        model = self.model_for(role)
        msgs = list(messages)
        last_err: Exception | None = None
        for _repair in range(2):
            resp = self._call(model, role, msgs, schema, thinking, max_tokens, temperature, seed)
            text = resp.choices[0].message.content or ""
            usage = resp.usage
            tin = getattr(usage, "prompt_tokens", 0) or 0
            tout = getattr(usage, "completion_tokens", 0) or 0
            cost = self._price(role, tin, tout)
            self._charge_daily(cost)
            self._stat(model, "calls")
            if "<think>" in text:
                self._stat(model, "think_tags_in_content")
            res = LLMResult(_THINK.sub("", text).strip(), None, role, task, model, tin, tout, cost,
                            int((time.perf_counter() - t0) * 1000))
            if budget:
                budget.add(res)
            if schema is None:
                self._record(task, messages, res)
                return res
            try:
                res.data = extract_json(text)
                _check_schema(res.data, schema)
                self._record(task, messages, res)
                return res
            except ValueError as e:
                last_err = e
                log.warning("JSON repair round for %s/%s: %s", role, task, e)
                self._stat(model, "json_repair_round")
                msgs = msgs + [
                    {"role": "assistant", "content": text[:4000]},
                    {"role": "user", "content": f"That was not valid JSON for the schema ({e}). "
                     "Reply with ONLY the JSON object, no prose, no code fences."},
                ]
        raise LLMError(f"model returned invalid JSON for {task}: {last_err}")

    # ---------------------------------------------------------------- recorded fixtures
    # VOUCH_RECORD_FILE=path.jsonl records every real call; with VOUCH_PROVIDER=mock the same file is
    # replayed (exact prompt match), falling back to the deterministic mock. Lets CI run real-model fixtures.
    @staticmethod
    def _key(task: str, messages: list[dict]) -> str:
        import hashlib

        return hashlib.sha256((task + json.dumps(messages, sort_keys=True, ensure_ascii=False)).encode()).hexdigest()

    def _record(self, task: str, messages: list[dict], res: LLMResult) -> None:
        import os

        path = os.environ.get("VOUCH_RECORD_FILE")
        if not path:
            return
        with self._daily_lock, open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps({"key": self._key(task, messages), "task": task, "model": res.model,
                                "text": res.text}, ensure_ascii=False) + "\n")

    def _replay(self, task: str, messages: list[dict]) -> str | None:
        import os

        path = os.environ.get("VOUCH_RECORD_FILE")
        if not path or not os.path.exists(path):
            return None
        if getattr(self, "_fixtures", None) is None:
            with open(path, encoding="utf-8") as f:
                self._fixtures = {r["key"]: r["text"] for r in map(json.loads, f) if r.get("key")}
        return self._fixtures.get(self._key(task, messages))

    def _call(self, model, role, msgs, schema, thinking, max_tokens, temperature, seed):
        extra: dict[str, Any] = {}
        if self.s.vouch_thinking_param == "chat_template_kwargs":
            extra["chat_template_kwargs"] = {"enable_thinking": bool(thinking)}
        kwargs: dict[str, Any] = {"model": model, "messages": msgs, "max_tokens": max_tokens + (2500 if thinking else 0),
                                  "temperature": temperature}
        if seed is not None:
            kwargs["seed"] = seed
        mode = self._json_mode.get(model, self.s.vouch_json_mode) if schema else None
        if mode == "json_schema":
            kwargs["response_format"] = {"type": "json_schema",
                                         "json_schema": {"name": "out", "schema": schema, "strict": False}}
        elif mode == "json_object":
            kwargs["response_format"] = {"type": "json_object"}
        from openai import (
            APIConnectionError,
            APITimeoutError,
            BadRequestError,
            InternalServerError,
            RateLimitError,
        )

        delay = 1.0
        for attempt in range(self.s.vouch_llm_max_retries + 1):
            try:
                return self.client.chat.completions.create(**kwargs, extra_body=extra or None)
            except BadRequestError as e:
                # Degrade gracefully when a model rejects a structured-output or template option.
                msg = str(e).lower()
                if "response_format" in kwargs and ("response_format" in msg or "schema" in msg or "json" in msg):
                    nxt = "json_object" if kwargs["response_format"]["type"] == "json_schema" else "prompt"
                    log.warning("%s rejected %s; falling back to %s", model, kwargs["response_format"]["type"], nxt)
                    self._stat(model, f"rejected_{kwargs['response_format']['type']}")
                    self._json_mode[model] = nxt
                    if nxt == "json_object":
                        kwargs["response_format"] = {"type": "json_object"}
                    else:
                        kwargs.pop("response_format")
                    continue
                if "seed" in kwargs and "seed" in msg:
                    log.warning("%s rejected seed; dropping it", model)
                    self._stat(model, "rejected_seed")
                    kwargs.pop("seed")
                    continue
                if extra and "chat_template" in msg:
                    log.warning("%s rejected chat_template_kwargs; dropping it", model)
                    self._stat(model, "rejected_chat_template_kwargs")
                    extra = {}
                    continue
                raise
            except (RateLimitError, APIConnectionError, APITimeoutError, InternalServerError) as e:
                self._stat(model, f"retry_{type(e).__name__}")
                if attempt >= self.s.vouch_llm_max_retries:
                    raise LLMError(f"{model}: {e}") from e
                time.sleep(delay + random.random() * 0.5)
                delay *= 2
        raise LLMError(f"{model}: retries exhausted")

    def embed(self, texts: list[str], budget: Budget | None = None) -> list[list[float]] | None:
        if not texts:
            return []
        if self.s.mock:
            from vouch.llm import mock

            return [mock.embed(t) for t in texts]
        model = self.models.get("embed")
        if not model:
            return None
        try:
            if budget:
                budget.check()
            t0 = time.perf_counter()
            resp = self.client.embeddings.create(model=model, input=[t[:8000] for t in texts])
            tin = getattr(resp.usage, "prompt_tokens", 0) or 0
            cost = self._price("embed", tin, 0)
            self._charge_daily(cost)
            if budget:
                budget.add(LLMResult("", None, "embed", "embed", model, tin, 0, cost,
                                     int((time.perf_counter() - t0) * 1000)))
            return [d.embedding for d in resp.data]
        except BudgetExceeded:
            raise
        except Exception as e:  # FTS5 is the fallback
            log.warning("embedding failed, falling back to FTS only: %s", e)
            return None


_router: Router | None = None


def get_router(settings: Settings | None = None) -> Router:
    global _router
    if _router is None:
        from vouch.config import get_settings

        _router = Router(settings or get_settings())
        _router.discover()
    return _router


def set_router(r: Router | None) -> None:
    global _router
    _router = r
