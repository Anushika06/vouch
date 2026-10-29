"""Deterministic demo web: seeded benign and attack pages under fictional `.example` domains.

Served publicly at /demo-sites/<domain>/<path> (so Tavily can extract them on the hosted demo) and
resolved locally by `Web.extract` so scenarios are reproducible. Evals add per-variant pages as overlays.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from vouch.util import content_words

SITES_DIR = Path(__file__).resolve().parent.parent / "demo" / "seed" / "sites"


def norm_url(url: str) -> str:
    u = urlparse(url if "://" in url else f"https://{url}")
    host = (u.hostname or "").lower().removeprefix("www.")
    path = u.path.rstrip("/") or "/"
    return f"{host}{path}"


@lru_cache
def _base() -> tuple[dict, list]:
    pages: dict[str, tuple[str | None, str]] = {}
    for f in SITES_DIR.rglob("*.html"):
        rel = f.relative_to(SITES_DIR).as_posix()
        domain, _, path = rel.partition("/")
        path = "/" + path.removesuffix(".html")
        if path.endswith("/index"):
            path = path[: -len("/index")] or "/"
        html = f.read_text(encoding="utf-8")
        title = None
        if "<title>" in html:
            title = html.split("<title>", 1)[1].split("</title>", 1)[0].strip()
        pages[norm_url(f"https://{domain}{path}")] = (title, html)
    idx_file = SITES_DIR / "search_index.json"
    index = json.loads(idx_file.read_text(encoding="utf-8")) if idx_file.exists() else []
    return pages, index


class DemoWeb:
    def __init__(self):
        base_pages, base_index = _base()
        self.pages = dict(base_pages)
        self.index = list(base_index)

    def add_page(self, url: str, html: str, title: str | None = None, snippet: str | None = None,
                 keywords: list[str] | None = None) -> None:
        self.pages[norm_url(url)] = (title, html)
        if keywords:
            self.index.insert(0, {"url": url, "title": title or url, "content": snippet or "", "keywords": keywords})

    def add_result(self, url: str, title: str, content: str, keywords: list[str]) -> None:
        self.index.insert(0, {"url": url, "title": title, "content": content, "keywords": keywords})

    def page(self, url: str) -> tuple[str | None, str] | None:
        return self.pages.get(norm_url(url))

    def search(self, query: str, n: int = 5) -> list[dict]:
        q = content_words(query)
        scored = []
        for i, r in enumerate(self.index):
            kw = {w.lower() for w in r.get("keywords", [])}
            overlap = len(q & kw)
            need = r.get("min_match", 2 if len(kw) > 2 else 1)
            if overlap >= need:
                scored.append((-overlap, i, r))
        scored.sort()
        return [{"url": r["url"], "title": r["title"], "content": r["content"], "score": round(0.99 - 0.02 * k, 2)}
                for k, (_, _, r) in enumerate(scored[:n])]

    def site_pages(self, url: str) -> list[tuple[str, str | None, str]]:
        host = norm_url(url).split("/", 1)[0]
        return [(f"https://{k}", t, h) for k, (t, h) in sorted(self.pages.items()) if k.split("/", 1)[0] == host]

    def is_demo(self, url: str) -> bool:
        return norm_url(url) in self.pages

    @staticmethod
    def public_url(url: str, base: str) -> str | None:
        if not base:
            return None
        n = norm_url(url)
        return f"{base.rstrip('/')}/demo-sites/{n}"
