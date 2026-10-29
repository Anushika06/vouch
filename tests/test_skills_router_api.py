import json

import pytest

from vouch.gate.corroboration import corroborate
from vouch.llm.router import extract_json, resolve_models
from vouch.skills.manager import SkillManager
from vouch.skills.sandbox import openshell_policy
from vouch.skills.scanner import parse_manifest


def test_resolve_models_by_substring():
    available = ["nvidia/Nemotron-3_5-Lightning", "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", "nvidia/Nemotron-3-Super-120B-A12B",
                 "nvidia/Nemotron-3-Ultra-550B-A55B", "nvidia/Nemotron-3_5-Super-VL", "Qwen/Qwen3-Embedding-8B", "meta/llama"]
    r = resolve_models(available)
    assert r["chat"] == "nvidia/Nemotron-3_5-Lightning"
    assert r["reader"] == "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"
    assert r["planner"] == "nvidia/Nemotron-3-Super-120B-A12B"
    assert r["audit"] == "nvidia/Nemotron-3-Ultra-550B-A55B"
    assert r["vl"] == "nvidia/Nemotron-3_5-Super-VL"
    assert r["embed"] == "Qwen/Qwen3-Embedding-8B"


def test_extract_json_repairs_common_wrappers():
    assert extract_json('<think>hmm</think>```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json('Sure! Here it is: {"a": {"b": "}"}} trailing') == {"a": {"b": "}"}}
    with pytest.raises(ValueError):
        extract_json("no json here")


def test_malicious_skill_flagged_and_sandboxed(make_ws):
    ws = make_ws()
    sm = SkillManager(ws)
    st = sm.stage("pdf-toolkit-pro")
    kinds = {f["kind"] for f in st["scan"]}
    assert {"network_import", "base64_blob", "planted_instruction", "sensitive_path"} <= kinds
    assert st["review"]["verdict"] == "malicious"
    assert "error" in sm.approve("pdf-toolkit-pro")  # needs explicit override
    sm.approve("pdf-toolkit-pro", override=True)
    res = sm.run("pdf-toolkit-pro", {})
    blocked = {b["kind"] for b in res["blocked"]}
    assert "network" in blocked and "file_read" in blocked


def test_benign_skill_runs(make_ws):
    ws = make_ws()
    sm = SkillManager(ws)
    st = sm.stage("expense-summary")
    assert st["review"]["verdict"] == "benign" and not st["scan"]
    sm.approve("expense-summary")
    res = sm.run("expense-summary", {})
    assert res["ok"] and "Groceries" in res["output"]


def test_hash_pin_detects_tampering(make_ws):
    ws = make_ws()
    sm = SkillManager(ws)
    sm.stage("unit-converter")
    sm.approve("unit-converter")
    (sm.dir / "unit-converter" / "run.py").write_text("print('pwned')", encoding="utf-8")
    assert "hash pin" in sm.run("unit-converter", {})["error"]


def test_openshell_policy_from_manifest():
    from pathlib import Path

    man = parse_manifest(Path("vouch/skills/catalog/expense-summary"))
    man.network = ["api.example.com"]
    pol = openshell_policy(man)
    assert pol["version"] == 1 and "/tmp" in pol["filesystem_policy"]["read_write"]
    ep = next(iter(pol["network_policies"].values()))["endpoints"][0]
    assert ep["host"] == "api.example.com" and ep["port"] == 443


def test_corroboration_defeats_syndicated_pages(make_ws):
    from vouch.agent import Agent

    ws = make_ws()
    a = Agent(ws)
    a.turn("Research this page for me: https://gadgetbargain.example/aurora-x14", demo_only=True)
    claim = next(m for m in ws.store.all() if "64GB" in m.content)
    c = corroborate(ws, claim, demo_only=True)
    assert not c.upgraded
    assert {"laptopsavers.example", "cheapnotebooks.example"} <= {f["domain"] for f in c.filtered}


def test_corroboration_upgrades_true_fact(make_ws):
    from vouch.agent import Agent

    ws = make_ws()
    Agent(ws).turn("Research this page for me: https://laptoplab.example/best-laptops-under-80000", demo_only=True)
    claim = next(m for m in ws.store.all() if "1.2 kg" in m.content)
    c = corroborate(ws, claim, demo_only=True)
    assert c.upgraded and c.independent_domains >= 3


def test_corroboration_never_upgrades_contacts(make_ws):
    ws = make_ws()
    contact = ws.store.contacts(require_trusted=True)[0]
    c = corroborate(ws, contact, demo_only=True)
    assert "never upgraded" in c.note or "only claims" in c.note


def test_api_smoke(tmp_path, monkeypatch):
    monkeypatch.setenv("VOUCH_PROVIDER", "mock")
    monkeypatch.setenv("VOUCH_DATA_DIR", str(tmp_path))
    from vouch.config import get_settings

    get_settings.cache_clear()
    from fastapi.testclient import TestClient

    import vouch.llm.router as rt
    from vouch.api.main import app

    rt.set_router(None)
    with TestClient(app) as c:
        assert c.get("/healthz").json()["ok"]
        r = c.post("/api/chat", json={"message": "Summarize this deal page for me: https://dealz-hub.example/laptop-deals"})
        assert r.status_code == 200
        sid = r.headers["x-vouch-session"]
        ap = c.get("/api/approvals", headers={"x-vouch-session": sid}).json()
        assert ap["memories"] and json.dumps(ap["sources"]).count("acme-refunds") >= 1
        assert c.get("/demo-sites/dealz-hub.example/laptop-deals").status_code == 200
        for probe in ("/demo-sites/../../pyproject.toml", "/demo-sites/..%2F..%2F..%2Fpyproject.toml",
                      "/..%2Fpyproject.toml"):
            assert "[project]" not in c.get(probe).text
    get_settings.cache_clear()
