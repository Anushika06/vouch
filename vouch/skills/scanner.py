"""Skill manifest parsing and static scan (AST) against the declared permissions."""

from __future__ import annotations

import ast
import base64
import binascii
import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from vouch.reader.detector import flags_for, is_instruction
from vouch.util import URL_RE, domain_of

NETWORK_MODULES = {"socket", "urllib", "urllib.request", "http.client", "requests", "httpx", "aiohttp", "ftplib",
                   "smtplib", "telnetlib", "websocket", "websockets"}
PROCESS_MODULES = {"subprocess", "pty", "multiprocessing"}
DANGEROUS_MODULES = {"ctypes", "cffi", "pickle", "marshal", "importlib", "shutil", "winreg"}
DANGEROUS_CALLS = {"eval", "exec", "compile", "__import__"}
OS_CALLS = {"system", "popen", "execv", "execve", "execl", "spawnl", "spawnv", "fork", "remove", "unlink", "rmdir",
            "startfile", "kill"}
_B64 = re.compile(r"^[A-Za-z0-9+/=_-]{32,}$")


@dataclass
class Manifest:
    name: str
    description: str
    version: str = "0.1.0"
    entrypoint: str = "run.py"
    network: list[str] = field(default_factory=list)
    files: list[str] = field(default_factory=list)
    tools: list[str] = field(default_factory=list)
    raw: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {"name": self.name, "description": self.description, "version": self.version,
                "entrypoint": self.entrypoint,
                "permissions": {"network": self.network, "files": self.files, "tools": self.tools}}


def parse_manifest(skill_dir: Path) -> Manifest:
    text = (skill_dir / "SKILL.md").read_text(encoding="utf-8")
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.S)
    if not m:
        raise ValueError("SKILL.md is missing YAML frontmatter")
    fm = yaml.safe_load(m.group(1)) or {}
    perms = fm.get("permissions") or {}
    name = str(fm.get("name") or skill_dir.name)
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,63}", name):
        raise ValueError(f"invalid skill name {name!r}")
    return Manifest(name=name, description=str(fm.get("description", "")), version=str(fm.get("version", "0.1.0")),
                    entrypoint=str(fm.get("entrypoint", "run.py")), network=[str(d).lower() for d in perms.get("network") or []],
                    files=[str(f) for f in perms.get("files") or []], tools=[str(t) for t in perms.get("tools") or []],
                    raw=fm)


def hash_pin(skill_dir: Path) -> str:
    h = hashlib.sha256()
    for f in sorted(p for p in skill_dir.rglob("*") if p.is_file() and "__pycache__" not in p.parts):
        h.update(f.relative_to(skill_dir).as_posix().encode())
        h.update(b"\0")
        h.update(f.read_bytes())
        h.update(b"\0")
    return h.hexdigest()


@dataclass
class Finding:
    severity: str  # high | medium | low
    kind: str
    detail: str
    file: str
    line: int = 0

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def _domain_allowed(dom: str, allowed: list[str]) -> bool:
    return any(dom == a or dom.endswith("." + a) for a in allowed)


def scan(skill_dir: Path, man: Manifest) -> list[Finding]:
    out: list[Finding] = []
    for f in sorted(skill_dir.rglob("*.py")):
        rel = f.relative_to(skill_dir).as_posix()
        src = f.read_text(encoding="utf-8", errors="replace")
        try:
            tree = ast.parse(src)
        except SyntaxError as e:
            out.append(Finding("high", "syntax", f"cannot parse: {e}", rel, e.lineno or 0))
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import | ast.ImportFrom):
                mods = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""]
                for mod in mods:
                    root = mod.split(".")[0]
                    if mod in NETWORK_MODULES or root in NETWORK_MODULES:
                        sev = "medium" if man.network else "high"
                        out.append(Finding(sev, "network_import", f"imports {mod} but declares network: {man.network or 'none'}",
                                           rel, node.lineno))
                    elif root in PROCESS_MODULES:
                        out.append(Finding("high", "process_import", f"imports {mod} (can run other programs)", rel, node.lineno))
                    elif root in DANGEROUS_MODULES:
                        out.append(Finding("medium", "dangerous_import", f"imports {mod}", rel, node.lineno))
            elif isinstance(node, ast.Call):
                fn = node.func
                if isinstance(fn, ast.Name) and fn.id in DANGEROUS_CALLS:
                    out.append(Finding("high", "dynamic_code", f"calls {fn.id}()", rel, node.lineno))
                if isinstance(fn, ast.Attribute) and fn.attr in OS_CALLS and isinstance(fn.value, ast.Name) and fn.value.id == "os":
                    out.append(Finding("high", "os_call", f"calls os.{fn.attr}()", rel, node.lineno))
                if isinstance(fn, ast.Name) and fn.id == "open" and node.args and isinstance(node.args[0], ast.Constant):
                    p = str(node.args[0].value)
                    if p.startswith(("/", "~", "..")) or re.match(r"^[A-Za-z]:\\", p) or ".ssh" in p:
                        out.append(Finding("high", "file_access", f"opens {p} outside the skill folder", rel, node.lineno))
                    elif man.files and p not in man.files:
                        out.append(Finding("medium", "file_access", f"opens {p}, not declared in files", rel, node.lineno))
            elif isinstance(node, ast.Constant) and isinstance(node.value, str):
                s = node.value
                for url in URL_RE.findall(s):
                    dom = domain_of(url)
                    if not _domain_allowed(dom, man.network):
                        out.append(Finding("high", "undeclared_domain", f"contacts {dom} (not in manifest)", rel, node.lineno))
                if _B64.match(s.strip()):
                    try:
                        dec = base64.b64decode(s.strip() + "==", validate=False).decode("utf-8", "strict")
                        if dec.isprintable() and len(dec) > 8:
                            out.append(Finding("high", "base64_blob", f"base64 blob decodes to: {dec[:80]}", rel, node.lineno))
                    except (binascii.Error, UnicodeDecodeError, ValueError):
                        out.append(Finding("low", "opaque_blob", f"long opaque string ({len(s)} chars)", rel, node.lineno))
                if re.search(r"(?:^/etc/|\.ssh\b|\.aws\b|win\.ini|^\.\./|\bid_rsa\b|vouch\.db)", s):
                    out.append(Finding("high", "sensitive_path", f"references {s[:60]} outside the skill folder", rel,
                                       node.lineno))
                if len(s) > 20 and is_instruction(flags_for(s)):
                    out.append(Finding("medium", "planted_instruction", f"string addresses an AI agent: {s[:90]}", rel, node.lineno))
    return out
