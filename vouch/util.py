from __future__ import annotations

import hashlib
import json
import os
import re
import time
from datetime import UTC, datetime
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import tldextract

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_tld = tldextract.TLDExtract(suffix_list_urls=())


def new_id(prefix: str) -> str:
    """ULID-style id: 48-bit ms timestamp + 80 random bits, Crockford base32."""
    n = (int(time.time() * 1000) << 80) | int.from_bytes(os.urandom(10), "big")
    chars = []
    for _ in range(26):
        chars.append(_CROCKFORD[n & 31])
        n >>= 5
    return f"{prefix}_{''.join(reversed(chars))}"


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", "replace")).hexdigest()


def utcnow() -> datetime:
    return datetime.now(UTC)


LOCAL_TZ = ZoneInfo("Asia/Kolkata")  # the demo persona's timezone; calendar times are wall-clock local


def local_iso(dt: datetime) -> str:
    return dt.astimezone(LOCAL_TZ).isoformat(timespec="seconds")


def local_day(dt: datetime, plus_days: int = 0) -> str:
    from datetime import timedelta

    return (dt.astimezone(LOCAL_TZ) + timedelta(days=plus_days)).date().isoformat()


def iso(dt: datetime | None = None) -> str:
    return (dt or utcnow()).astimezone(UTC).isoformat(timespec="seconds")


def parse_iso(s: str) -> datetime:
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, default=str)


def domain_of(url: str) -> str:
    host = urlparse(url if "://" in url else f"https://{url}").hostname or ""
    return host.lower().removeprefix("www.")


def registrable_domain(url_or_host: str) -> str:
    host = domain_of(url_or_host)
    ext = _tld(host)
    if ext.suffix and ext.domain:
        return f"{ext.domain}.{ext.suffix}"
    parts = host.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
URL_RE = re.compile(r"https?://[^\s\"'<>)]+")
PHONE_RE = re.compile(r"\+?\d[\d\s-]{8,}\d")
LONGNUM_RE = re.compile(r"\b\d{6,}\b")
IFSC_RE = re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b")
UPI_RE = re.compile(r"\b[\w.-]+@(?:upi|ok\w+|ybl|paytm|axl|ibl)\b", re.I)


def extract_entities(text: str) -> set[str]:
    """Security-relevant atoms (addresses, links, numbers) used for provenance grounding."""
    ents: set[str] = set()
    ents.update(e.lower() for e in EMAIL_RE.findall(text))
    ents.update(domain_of(u) for u in URL_RE.findall(text))
    ents.update(re.sub(r"[\s-]", "", p) for p in PHONE_RE.findall(text))
    ents.update(LONGNUM_RE.findall(text))
    ents.update(IFSC_RE.findall(text))
    return {e for e in ents if e}


def normalize_for_match(text: str) -> str:
    t = text.lower()
    t = re.sub(r"(?<=\d)[\s-](?=\d)", "", t)
    return t


_WORD = re.compile(r"[a-z0-9]+")
STOP = set(
    "a an the and or of to in on for with is are was were be been my me i you your it this that at by from as "
    "has have had do does did not no so if then than but about into over under up down out please can could "
    "would should will just".split()
)


def content_words(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if w not in STOP and len(w) > 1}


def shingles(text: str, k: int = 5) -> set[str]:
    words = _WORD.findall(text.lower())
    return {" ".join(words[i : i + k]) for i in range(max(1, len(words) - k + 1))}


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def truncate(text: str, n: int) -> str:
    return text if len(text) <= n else text[: n - 1] + "…"


def containment(a: set, b: set) -> float:
    """Share of the smaller set found in the larger one; catches syndicated copies of a short excerpt."""
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))
