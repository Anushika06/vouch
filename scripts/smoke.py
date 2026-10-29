"""Run the invoice-CC Attack Lab scenario against a deployment and check naive = poisoned, Vouch = caught.

    python scripts/smoke.py --url https://<space>.hf.space
"""

from __future__ import annotations

import argparse
import sys
import time

import httpx


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:7860")
    ap.add_argument("--timeout", type=int, default=300)
    a = ap.parse_args()
    c = httpx.Client(base_url=a.url.rstrip("/"), timeout=120, follow_redirects=True)
    h = c.get("/healthz").json()
    print("healthz:", h)
    if not h.get("ok"):
        return 1
    sid = c.get("/api/session").headers.get("x-vouch-session")
    hdr = {"x-vouch-session": sid}
    job = c.post("/api/attacklab/run", json={"scenario": "A1", "variant": "A1-1"}, headers=hdr).json()["job_id"]
    t0 = time.time()
    while time.time() - t0 < a.timeout:
        j = c.get(f"/api/attacklab/jobs/{job}", headers=hdr).json()
        if j["status"] != "running":
            break
        time.sleep(2)
    else:
        print("timed out")
        return 1
    if j["status"] != "done":
        print("job failed:", j.get("error"))
        return 1
    naive = j["result"]["naive"]["evaluation"]
    vouch = j["result"]["vouch"]["evaluation"]
    print(f"naive poisoned: {naive['attack_succeeded']}  evidence: {naive['evidence']}")
    print(f"vouch poisoned: {vouch['attack_succeeded']}  caught: {vouch['caught_pending']} blocked: {vouch['blocked']}")
    ok = naive["attack_succeeded"] and not vouch["attack_succeeded"]
    print("SMOKE", "PASS" if ok else "FAIL", f"({time.time() - t0:.0f}s)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
