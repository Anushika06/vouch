"""Fail CI if a tracked file contains something that looks like a real API key."""

from __future__ import annotations

import re
import subprocess
import sys

PATTERNS = {
    "tavily": re.compile(r"tvly-(?:dev-)?[A-Za-z0-9]{20,}"),
    "nvidia": re.compile(r"nvapi-[A-Za-z0-9_-]{30,}"),
    "openai-style": re.compile(r"\bsk-[A-Za-z0-9_-]{32,}"),
    "hf": re.compile(r"\bhf_[A-Za-z0-9]{30,}"),
    "github": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}"),
    "jwt": re.compile(r"\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}"),
    "assigned-key": re.compile(r"(?i)(?:api_?key|secret|token)\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{32,}['\"]?"),
}
SKIP = (".lock", "package-lock.json", ".png", ".jpg", ".mp4", ".webm", ".zip")


def main() -> int:
    files = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout.split()
    bad = []
    for f in files:
        if f.endswith(SKIP) or f.startswith("scripts/check_secrets"):
            continue
        try:
            text = open(f, encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        for name, pat in PATTERNS.items():
            for m in pat.finditer(text):
                line = text.count("\n", 0, m.start()) + 1
                bad.append(f"{f}:{line}: possible {name} secret")
    if bad:
        print("\n".join(bad))
        return 1
    print(f"no secrets found in {len(files)} tracked files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
