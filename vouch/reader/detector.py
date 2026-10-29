"""Deterministic layer of the instruction detector.

The model-based reader also flags instructions; this layer is the floor that does not depend on a
model behaving. It finds (1) text a human would never see in an HTML page and (2) sentences that
address an AI agent or try to change rules, contacts or payment details.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from bs4 import BeautifulSoup, Comment

FLAG_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("imperative_to_ai", re.compile(
        r"\b(?:remember(?: that| this)?|note to (?:the )?(?:ai|assistant|agent)|from now on|going forward|henceforth|"
        r"(?:ai|llm|assistant|agent|bot)s?\s*[,:]|ignore (?:all |any |the )?(?:previous|prior|above|earlier)|"
        r"disregard|you (?:must|should|need to|are to) (?:now |always )?\w+|system (?:note|prompt|instruction|override|message)|"
        r"important (?:instruction|update) for|attention (?:ai|assistant|agent))", re.I)),
    ("memory_write", re.compile(
        r"\b(?:remember|save|store|note|record|update|add|write)\b[^.\n]{0,40}\b(?:memory|memories|records?|notes|profile|"
        r"preferences?|contacts?|address book|rules?)\b|\bremember (?:that|this)\b|"
        r"\bthe user (?:wants|prefers|has asked|likes|always|requires|instructed)\b|\bupdate your records\b", re.I)),
    ("standing_rule", re.compile(
        r"\b(?:always|every time|each time|whenever|from now on|going forward|by default|all future|"
        r"every (?:invoice|email|payment|message|report|receipt))\b", re.I)),
    ("exfiltration", re.compile(
        r"\b(?:cc|bcc|cc'?d|cc:|copy|copied|forward(?:ed)?|send (?:a )?copy|also (?:send|email)|share|route[sd]?)\b[^.\n]{0,80}"
        r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", re.I)),
    ("contact_change", re.compile(
        r"\b(?:new|updated|changed|correct|current)\s+(?:e-?mail|email address|address|phone|number|contact|"
        r"accountant|lawyer|doctor|manager|bank)|"
        r"\b(?:e-?mail|phone|number|address|contact|accountant|lawyer|manager)\s+(?:is now|has changed|changed to|now is|"
        r"has moved)|\bis now\b[^.\n]{0,40}@", re.I)),
    ("override", re.compile(
        r"\bforget (?:that|about|what|the)\b|\bno longer\b|\binstead of\b|\breplaces? (?:the )?(?:old|previous)\b|"
        r"\bit is now\b|\bdisregard\b", re.I)),
    ("payment_change", re.compile(
        r"\b(?:bank (?:details|account)|account (?:number|no\.?)|iban|ifsc|swift|routing number|upi(?: id)?|"
        r"wire (?:transfer|to)|payment (?:details|instructions|info)|beneficiary)\b", re.I)),
    ("secrecy", re.compile(
        r"\b(?:do not|don't|never) (?:tell|inform|mention|notify|show|alert)\b[^.\n]{0,30}\b(?:user|her|him|them|anyone|owner)\b|"
        r"\bsilently\b|\bquietly\b|\bwithout (?:asking|confirmation|confirming|telling|notifying)\b", re.I)),
]

# A sentence becomes a proposed memory write (surfaced in the approval inbox) only on strong signal.
_ACTION_FLAGS = {"exfiltration", "contact_change", "payment_change", "standing_rule", "override"}


def flags_for(text: str) -> list[str]:
    return [name for name, pat in FLAG_PATTERNS if pat.search(text)]


def is_instruction(flags: list[str], hidden: bool = False) -> bool:
    fs = set(flags)
    if "memory_write" in fs or "secrecy" in fs:
        return True
    if "imperative_to_ai" in fs and fs & _ACTION_FLAGS:
        return True
    if hidden and fs:
        return True
    return False


def is_memory_write_attempt(flags: list[str], hidden: bool = False) -> bool:
    fs = set(flags)
    if "memory_write" in fs:
        return True
    if fs & {"imperative_to_ai", "secrecy"} and fs & _ACTION_FLAGS:
        return True
    return hidden and bool(fs & (_ACTION_FLAGS | {"imperative_to_ai"}))


_SENT = re.compile(r"(?<=[.!?])\s+|\n+")


def sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENT.split(text) if len(s.strip()) > 3]


@dataclass
class Detection:
    text: str
    flags: list[str]
    hidden: str | None = None
    write_attempt: bool = False


def detect(text: str, hidden: str | None = None) -> list[Detection]:
    out = []
    for s in sentences(text):
        fl = flags_for(s)
        if is_instruction(fl, hidden is not None):
            out.append(Detection(s, fl, hidden, is_memory_write_attempt(fl, hidden is not None)))
    return out


# ------------------------------------------------------------------ HTML hidden-text analysis

_HIDE_DECL = [
    ("css:display-none", re.compile(r"display\s*:\s*none", re.I)),
    ("css:visibility-hidden", re.compile(r"visibility\s*:\s*hidden", re.I)),
    ("css:opacity-0", re.compile(r"opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)", re.I)),
    ("css:font-size-0", re.compile(r"font-size\s*:\s*0(?:\.\d+)?(?:px|em|rem|pt)?\s*(?:;|$)|font-size\s*:\s*1px", re.I)),
    ("css:offscreen", re.compile(r"(?:left|top|text-indent|margin-left)\s*:\s*-\d{3,}", re.I)),
    ("css:zero-size", re.compile(r"(?:height|width)\s*:\s*0(?:px)?\s*;[^}]*overflow\s*:\s*hidden|clip\s*:\s*rect\(0", re.I)),
]
_WHITE = re.compile(r"(?<![-\w])color\s*:\s*(?:#fff(?:fff)?\b|white\b|rgba?\(\s*255\s*,\s*255\s*,\s*255)", re.I)


def _decl_technique(style: str, page_bg_white: bool = True) -> str | None:
    for name, pat in _HIDE_DECL:
        if pat.search(style):
            return name
    if page_bg_white and _WHITE.search(style) and not re.search(r"background(?:-color)?\s*:\s*(?!#fff|white)", style, re.I):
        return "css:white-on-white"
    return None


def _class_rules(soup: BeautifulSoup) -> dict[str, str]:
    rules: dict[str, str] = {}
    for st in soup.find_all("style"):
        css = st.get_text()
        for sel, body in re.findall(r"([^{}]+)\{([^}]*)\}", css):
            for part in sel.split(","):
                part = part.strip()
                m = re.fullmatch(r"(?:\w+)?\.([\w-]+)", part)
                if m:
                    tech = _decl_technique(body)
                    if tech:
                        rules[m.group(1)] = tech
    return rules


@dataclass
class HtmlSplit:
    title: str | None
    visible: str
    hidden: list[tuple[str, str]] = field(default_factory=list)  # (technique, text)


def split_html(html: str) -> HtmlSplit:
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text(strip=True) if soup.title else None
    hidden: list[tuple[str, str]] = []

    for c in soup.find_all(string=lambda t: isinstance(t, Comment)):
        txt = " ".join(str(c).split())
        if len(txt) > 8:
            hidden.append(("html:comment", txt))
        c.extract()

    class_rules = _class_rules(soup)
    for tag in soup.find_all(["script", "style", "noscript"]):
        tag.decompose()
    for tpl in soup.find_all("template"):
        txt = " ".join(tpl.get_text(" ").split())
        if txt:
            hidden.append(("html:template", txt))
        tpl.decompose()

    for img in soup.find_all(["img", "area"]):
        for attr in ("alt", "title"):
            v = (img.get(attr) or "").strip()
            if len(v) > 40:  # short alts are normal; long prose in alt text is a carrier
                hidden.append((f"attr:{attr}", " ".join(v.split())))

    def technique(tag) -> str | None:
        if tag.has_attr("hidden"):
            return "html:hidden-attr"
        if tag.get("aria-hidden") == "true" and len(tag.get_text(strip=True)) > 20:
            return "aria-hidden"
        tech = _decl_technique(tag.get("style") or "")
        if tech:
            return tech
        for cls in tag.get("class") or []:
            if cls in class_rules:
                return class_rules[cls]
            if cls in ("sr-only", "visually-hidden", "screen-reader-text"):
                return "css:sr-only"
        return None

    for tag in list(soup.find_all(True)):
        if getattr(tag, "decomposed", False) or tag.parent is None:
            continue
        tech = technique(tag)
        if tech:
            txt = " ".join(tag.get_text(" ").split())
            if txt:
                hidden.append((tech, txt))
            tag.decompose()

    body = soup.body or soup
    visible = "\n".join(line.strip() for line in body.get_text("\n").splitlines() if line.strip())
    return HtmlSplit(title, visible, hidden)
