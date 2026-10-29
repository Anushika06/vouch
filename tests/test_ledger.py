from datetime import timedelta

from vouch.models import GateAction, GateDecision, Memory, MemType, Provenance, Status, Trust


def _mem(content, trust=Trust.GREEN, status=Status.active):
    return Memory(type=MemType.FACT, content=content, status=status, trust=trust,
                  provenance=[Provenance(kind="user_chat", ref="t1", principal="user", trust=trust, excerpt=content)],
                  gate_decision=GateDecision(action=GateAction.auto_save, reason="test"))


def test_every_write_is_a_commit_with_provenance(make_ws):
    ws = make_ws()
    before = len(ws.store.ledger.log())
    m = _mem("Asha likes jasmine tea")
    ws.store.save(m, "gate:auto_save")
    log = ws.store.ledger.log()
    assert len(log) == before + 1
    assert m.id in log[0]["title"]
    assert "source: user_chat t1" in log[0]["message"]
    assert "trust: GREEN" in log[0]["message"]


def test_history_and_revert(make_ws):
    ws = make_ws()
    m = _mem("Asha's gym is on 5th Main")
    ws.store.save(m, "create")
    first_sha = ws.store.history(m.id)[0]["sha"]
    m.content = "Asha's gym is on 9th Cross"
    ws.store.save(m, "edit")
    hist = ws.store.history(m.id)
    assert [h["snapshot"]["content"] for h in hist] == ["Asha's gym is on 9th Cross", "Asha's gym is on 5th Main"]
    ws.store.revert(m.id, first_sha)
    assert ws.store.get(m.id).content == "Asha's gym is on 5th Main"
    assert len(ws.store.history(m.id)) == 3


def test_time_travel_snapshot_and_rollback(make_ws):
    ws = make_ws()
    sha_before = ws.store.ledger.log()[0]["sha"]
    n_before = len(ws.store.ledger.snapshot(sha_before))
    ws.advance(1)
    ws.store.save(_mem("Planted later"), "create")
    assert len(ws.store.ledger.snapshot(ws.store.ledger.log()[0]["sha"])) == n_before + 1
    changed = ws.store.rollback(sha_before)
    assert changed == 1
    assert all(m.content != "Planted later" for m in ws.store.all({Status.active}))


def test_claim_ttl_expiry(make_ws):
    ws = make_ws()
    m = _mem("example.com says X", trust=Trust.RED, status=Status.claim)
    m.expires_at = (ws.now() + timedelta(days=30)).isoformat()
    ws.store.save(m, "gate:save_as_claim")
    ws.advance(31)
    expired = ws.store.expire_stale()
    assert [e.id for e in expired] == [m.id]
    assert ws.store.get(m.id).status == Status.expired


def test_recall_fts(make_ws):
    ws = make_ws()
    hits = ws.store.recall("who is my accountant")
    assert hits and "Ravi" in hits[0][0].content


def test_payment_vault_masks_ledger(make_ws):
    ws = make_ws()
    m = Memory(type=MemType.PAYMENT, content="", status=Status.pending_approval, trust=Trust.GREEN,
               provenance=[Provenance(kind="user_chat", ref="t", principal="user", trust=Trust.GREEN)])
    ws.store.vault_put(m, "Account 123456789012 at Northwind Bank")
    ws.store.save(m, "gate:queue_approval")
    assert "123456789012" not in ws.store.get(m.id).content
    assert ws.store.vault_get(m.id) == "Account 123456789012 at Northwind Bank"
    assert "123456789012" not in (ws.store.ledger.root / f"memories/PAYMENT/{m.id}.json").read_text(encoding="utf-8")


def test_export_zip(make_ws):
    import io
    import zipfile

    ws = make_ws()
    z = zipfile.ZipFile(io.BytesIO(ws.store.ledger.export_zip()))
    assert any(n.startswith("memories/CONTACT/") for n in z.namelist())
