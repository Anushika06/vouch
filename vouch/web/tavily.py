"""Tavily is the only way Vouch reads the web. Every response is cached in SQLite (keyed by request),
which saves credits and makes the demo deterministic. Demo pages (attack sites) are resolved locally."""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from vouch.config import Settings
from vouch.util import domain_of, iso, sha256
from vouch.web.demo import DemoWeb

log = logging.getLogger("vouch.web")


class WebLimit(Exception):
    pass


@dataclass
class WebResult:
    url: str
    title: str
    content: str
    score: float = 0.0
    source: str = "tavily"  # tavily | demo | cache
    raw_html: str | None = None


@dataclass
class WebPage:
    url: str
    title: str | None
    text: str
    html: str | None = None
    source: str = "tavily"


@dataclass
class WebMeter:
    cap: int = 0
    calls: int = 0
    cache_hits: int = 0
    log: list = field(default_factory=list)

    def charge(self, endpoint: str) -> None:
        if self.cap and self.calls >= self.cap:
            raise WebLimit("demo limit reached for web lookups in this session — clone the repo to run your own")
        self.calls += 1


class TavilyCache:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self.conn.execute("CREATE TABLE IF NOT EXISTS tavily_cache (key TEXT PRIMARY KEY, endpoint TEXT, "
                          "response TEXT, created_at TEXT)")

    def get(self, key: str):
        with self.lock:
            r = self.conn.execute("SELECT response FROM tavily_cache WHERE key=?", (key,)).fetchone()
        return json.loads(r[0]) if r else None

    def put(self, key: str, endpoint: str, resp) -> None:
        with self.lock:
            self.conn.execute("INSERT OR REPLACE INTO tavily_cache VALUES (?,?,?,?)",
                              (key, endpoint, json.dumps(resp, default=str), iso()))


class Web:
    def __init__(self, settings: Settings, cache: TavilyCache, demo: DemoWeb, meter: WebMeter | None = None):
        self.s = settings
        self.cache = cache
        self.demo = demo
        self.meter = meter or WebMeter()
        self._client = None

    @property
    def available(self) -> bool:
        return bool(self.s.tavily_api_key)

    @property
    def client(self):
        if self._client is None:
            from tavily import TavilyClient

            self._client = TavilyClient(api_key=self.s.tavily_api_key)
        return self._client

    def _cached(self, endpoint: str, params: dict, fn):
        key = sha256(endpoint + json.dumps(params, sort_keys=True))
        hit = self.cache.get(key)
        if hit is not None:
            self.meter.cache_hits += 1
            self.meter.log.append({"endpoint": endpoint, "cached": True, "params": params})
            return hit
        self.meter.charge(endpoint)
        resp = fn()
        self.cache.put(key, endpoint, resp)
        self.meter.log.append({"endpoint": endpoint, "cached": False, "params": params})
        return resp

    # ------------------------------------------------------------------ endpoints
    def search(self, query: str, max_results: int = 5, topic: str = "general", demo_only: bool = False,
               depth: str = "advanced") -> list[WebResult]:
        out = [WebResult(r["url"], r["title"], r["content"], r.get("score", 0.9), "demo")
               for r in self.demo.search(query, max_results)] if self.s.vouch_demo_web else []
        if demo_only or not self.available:
            return out[:max_results]
        params = {"query": query, "max_results": max_results, "topic": topic, "search_depth": depth}
        try:
            resp = self._cached("search", params, lambda: self.client.search(**params))
        except WebLimit:
            raise
        except Exception as e:
            log.warning("tavily search failed: %s", e)
            return out
        seen = {r.url for r in out}
        for r in resp.get("results", []):
            if r.get("url") not in seen:
                out.append(WebResult(r["url"], r.get("title") or r["url"], r.get("content") or "", r.get("score", 0)))
        return out[: max_results + len([o for o in out if o.source == "demo"])]

    def extract(self, url: str) -> WebPage:
        demo = self.demo.page(url)
        if demo is not None:
            title, html = demo
            text = None
            public = self.demo.public_url(url, self.s.vouch_public_url)
            if self.s.vouch_demo_via_tavily and public and self.available:
                try:
                    resp = self._cached("extract", {"urls": [public]},
                                        lambda: self.client.extract(urls=[public], extract_depth="advanced"))
                    res = (resp.get("results") or [{}])[0]
                    text = res.get("raw_content")
                except Exception as e:
                    log.warning("tavily extract of public demo page failed: %s", e)
            return WebPage(url, title, text or "", html, "demo+tavily" if text else "demo")
        if not self.available:
            return WebPage(url, None, "", None, "unavailable")
        resp = self._cached("extract", {"urls": [url], "depth": "advanced"},
                            lambda: self.client.extract(urls=[url], extract_depth="advanced", format="markdown"))
        res = (resp.get("results") or [{}])[0]
        return WebPage(url, res.get("title"), res.get("raw_content") or "", None, "tavily")

    def research(self, question: str, timeout_s: float = 120) -> dict:
        """Tavily research endpoint (async task; we poll). Falls back to search when unavailable."""
        if not self.available:
            rs = self.search(question, max_results=5)
            return {"content": "", "sources": [{"url": r.url, "title": r.title, "content": r.content} for r in rs],
                    "fallback": "search"}

        def run():
            task = self.client.research(input=question, model="mini")
            rid = task.get("request_id")
            if not rid:
                return task
            t0 = time.time()
            while time.time() - t0 < timeout_s:
                r = self.client.get_research(rid)
                if r.get("status") in ("completed", "failed"):
                    return r
                time.sleep(3)
            return {"status": "timeout", "request_id": rid}

        try:
            resp = self._cached("research", {"input": question, "model": "mini"}, run)
        except WebLimit:
            raise
        except Exception as e:
            log.warning("tavily research failed, using search: %s", e)
            rs = self.search(question, max_results=5)
            return {"content": "", "sources": [{"url": r.url, "title": r.title, "content": r.content} for r in rs],
                    "fallback": "search"}
        content = resp.get("content") or resp.get("report") or ""
        if isinstance(content, dict):
            content = json.dumps(content)
        sources = resp.get("sources") or []
        return {"content": content, "sources": [{"url": s.get("url"), "title": s.get("title") or s.get("url"),
                                                 "content": s.get("content", "")} for s in sources if s.get("url")]}

    def crawl(self, url: str, limit: int = 8) -> list[WebPage]:
        demo_pages = self.demo.site_pages(url)
        if demo_pages:
            return [WebPage(u, t, "", h, "demo") for u, t, h in demo_pages[:limit]]
        if not self.available:
            return []
        resp = self._cached("crawl", {"url": url, "limit": limit},
                            lambda: self.client.crawl(url=url, limit=limit, max_depth=2, extract_depth="basic"))
        return [WebPage(r.get("url"), None, r.get("raw_content") or "", None, "tavily")
                for r in resp.get("results", []) if r.get("url")]

    def site_map(self, url: str, limit: int = 30) -> list[str]:
        demo_pages = self.demo.site_pages(url)
        if demo_pages:
            return [u for u, _, _ in demo_pages]
        if not self.available:
            return []
        resp = self._cached("map", {"url": url, "limit": limit}, lambda: self.client.map(url=url, limit=limit))
        return list(resp.get("results", []))


def is_demo_domain(url: str) -> bool:
    return domain_of(url).endswith(".example")
