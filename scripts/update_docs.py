"""Fill README / DEVPOST / video script numbers and links from evals/results/latest.json.

    python scripts/update_docs.py --demo https://<space>.hf.space --video https://youtu.be/<id>

Only reads the published (non-mock) results file. Refuses to fill numbers from a mock run.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LATEST = ROOT / "evals" / "results" / "latest.json"
FILES = [ROOT / "README.md", ROOT / "DEVPOST.md", ROOT / "video" / "script.md"]


def pct(x) -> str:
    return "n/a" if x is None else f"{100 * x:.0f}%"


def numbers(res: dict) -> dict:
    cfg = res["aggregate"]["configs"]
    nv, vf = cfg.get("naive", {}), cfg.get("vouch-full", {})
    day = next((d for d in res.get("day", []) if d["config"] == "vouch-full"), None)
    lme = res.get("longmemeval") or {}
    return {
        "RUNS": str(res.get("runs")),
        "N_ATTACKS": str(len({a["variant"] for a in res.get("attacks", [])})),
        "N_BENIGN": str(vf.get("benign", {}).get("cases", "n/a")),
        "ASR_NAIVE": pct(nv.get("attack_success_rate", {}).get("mean")),
        "ASR_VOUCH": pct(vf.get("attack_success_rate", {}).get("mean")),
        "FP_RATE": f"{100 * vf['benign']['false_positive_rate']['mean']:.1f}%" if vf.get("benign", {}).get(
            "false_positive_rate", {}).get("mean") is not None else "n/a",
        "APPROVALS_PER_100": str(vf.get("approval_prompts_per_100_interactions", "n/a")),
        "LME_VOUCH": pct(lme.get("vouch-full", {}).get("accuracy")) if lme else "n/a",
        "LME_NAIVE": pct(lme.get("naive", {}).get("accuracy")) if lme else "n/a",
        "DAY_COST": f"${day['cost_usd']:.3f}" if day else "n/a",
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", default="")
    ap.add_argument("--video", default="")
    ap.add_argument("--repo", default="https://github.com/Anushika06/vouch")
    a = ap.parse_args()
    subs = {"REPO_URL": a.repo}
    if a.demo:
        subs["DEMO_URL"] = a.demo
    if a.video:
        subs["VIDEO_URL"] = a.video
    md = None
    if LATEST.exists():
        res = json.loads(LATEST.read_text(encoding="utf-8"))
        if res.get("provider") == "mock":
            print("refusing to publish numbers from a mock run")
            return 1
        subs.update(numbers(res))
        md = (ROOT / "evals" / "results" / "latest.md").read_text(encoding="utf-8")
    else:
        print("no evals/results/latest.json yet: filling links only")
    for f in FILES:
        if not f.exists():
            continue
        text = f.read_text(encoding="utf-8")
        for k, v in subs.items():
            text = text.replace("{{" + k + "}}", v)
        if md and f.name == "README.md":
            body = md.split("\n", 2)[2] if md.startswith("# ") else md
            text = re.sub(r"<!-- EVAL:START -->.*?<!-- EVAL:END -->",
                          "<!-- EVAL:START -->\n" + body.strip() + "\n<!-- EVAL:END -->", text, flags=re.S)
        f.write_text(text, encoding="utf-8")
        print("updated", f.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
