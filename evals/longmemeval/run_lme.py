"""LongMemEval_s utility check: does the gate cost us long-term memory accuracy?

Dataset: xiaowu0162/longmemeval (LongMemEval_s, Wu et al., ICLR 2025). We take a stratified subset by
question type, ingest each question's haystack sessions through the memory writer (+ Trust Gate for
vouch-full; save-everything for naive), answer with Nemotron 3.5 Lightning over recalled memories, and
judge with Nemotron 3 Super using the official LongMemEval judge prompts, lightly adapted. The paper's
judge is GPT-4o, so numbers are not directly comparable to the leaderboard.

    python -m evals.longmemeval.run_lme --n 100
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import random
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from vouch.llm.router import Router  # noqa: E402
from vouch.memory.writer import WRITER_SCHEMA  # noqa: E402
from vouch.models import (  # noqa: E402
    GateAction,
    GateDecision,
    Memory,
    MemType,
    Provenance,
    Span,
    Status,
    Trust,
)
from vouch.workspace import AgentConfig, Workspace  # noqa: E402

URL = "https://huggingface.co/datasets/xiaowu0162/longmemeval/resolve/main/longmemeval_s"
CACHE = ROOT / "data" / "longmemeval_s.json"
MAX_SESSION_CHARS = 12_000

INGEST_SYSTEM = """You maintain a user's long-term memory. Read one past chat session (dated {date}) between the
user (span U) and an assistant (span A). Extract every durable, specific fact worth remembering for future
questions: personal details, preferences, plans, events with dates, numbers, names, possessions, changes to
earlier facts, and notable things the assistant recommended or stated. Start each memory with the session
date in brackets, e.g. "[{date}] The user adopted a cat named Luna". Cite "U" for what the user said and "A"
for what the assistant said. Up to 12 memories.
Reply JSON only: {{"memories": [{{"content": "...", "type": "FACT|PREFERENCE|EVENT|CONTACT", "span_ids": ["U"]}}]}}"""

ANSWER_SYSTEM = """Answer the user's question using ONLY the memories provided (each starts with its date). Today is
{qdate}. Reason about dates and updates carefully: when facts changed over time, use the latest. If the memories
do not contain the answer, say you don't know. Answer concisely."""

JUDGE = {
    "default": "I will give you a question, a correct answer, and a response from a model. Please answer yes if the "
               "response contains the correct answer. Otherwise, answer no. If the response is equivalent to the "
               "correct answer or contains all the intermediate steps to get the correct answer, you should also "
               "answer yes. If the response only contains a subset of the information required by the answer, answer no.",
    "temporal-reasoning": "I will give you a question, a correct answer, and a response from a model. Please answer yes "
               "if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the "
               "correct answer or contains all the intermediate steps to get the correct answer, you should also answer "
               "yes. If the response only contains a subset of the information required by the answer, answer no. In "
               "addition, do not penalize off-by-one errors for the number of days.",
    "knowledge-update": "I will give you a question, a correct answer, and a response from a model. Please answer yes if "
               "the response contains the correct answer. Otherwise, answer no. If the response contains some previous "
               "information along with an updated answer, the response should be considered as correct as long as the "
               "updated answer is the required answer.",
    "single-session-preference": "I will give you a question, a rubric for desired personalized response, and a response "
               "from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The "
               "model does not need to reflect all the points in the rubric. The response is correct as long as it recalls "
               "and utilizes the user's personal information correctly.",
    "abstention": "I will give you an unanswerable question, an explanation, and a response from a model. Please answer "
               "yes if the model correctly identifies the question as unanswerable. The model could say that the "
               "information is incomplete, or some other information is given but the asked information is not.",
}
JUDGE_SCHEMA = {"type": "object", "properties": {"correct": {"type": "boolean"}}, "required": ["correct"]}


def load(n: int, seed: int = 7) -> list[dict]:
    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading LongMemEval_s (~278 MB) to {CACHE} …")
        with httpx.stream("GET", URL, follow_redirects=True, timeout=600) as r:
            r.raise_for_status()
            with open(CACHE, "wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)
    data = json.loads(CACHE.read_text(encoding="utf-8"))
    by_type = defaultdict(list)
    for q in data:
        by_type["abstention" if q["question_id"].endswith("_abs") else q["question_type"]].append(q)
    rng = random.Random(seed)
    out = []
    for _t, qs in sorted(by_type.items()):
        k = max(1, round(n * len(qs) / len(data)))
        out += rng.sample(qs, min(k, len(qs)))
    rng.shuffle(out)
    return out[:n]


def _session_text(turns: list[dict]) -> tuple[str, str]:
    u = "\n".join(t["content"] for t in turns if t["role"] == "user")
    a = "\n".join(t["content"] for t in turns if t["role"] == "assistant")
    return u[:MAX_SESSION_CHARS], a[: MAX_SESSION_CHARS // 2]


def ingest(ws: Workspace, q: dict) -> None:
    from vouch.models import Candidate

    def one(item):
        date, turns = item
        u, a = _session_text(turns)
        res = ws.router.complete(
            "chat", [{"role": "system", "content": INGEST_SYSTEM.format(date=date)},
                     {"role": "user", "content": f"SPAN U (user):\n{u}\n\nSPAN A (assistant):\n{a}"}],
            task="lme.ingest", schema=WRITER_SCHEMA, max_tokens=900,
            mock_input={"user": u, "docs": [], "spans": ["U"], "existing": []}, budget=ws.budget)
        cands = [Candidate(content=str(m["content"])[:400], span_ids=[str(s) for s in m.get("span_ids") or ["U"]])
                 for m in (res.data or {}).get("memories", []) if isinstance(m, dict) and m.get("content")]
        spans = {"U": Span(id="U", kind="user_chat", ref=date, principal="user", trust=Trust.GREEN, text=u),
                 "A": Span(id="A", kind="agent", ref=date, principal="assistant", trust=Trust.YELLOW, text=a)}
        if ws.cfg.naive:
            for c in cands:
                ws.store.save(Memory(type=MemType.FACT, content=c.content, status=Status.active, trust=Trust.GREEN,
                                     provenance=[Provenance(kind="system", ref=date, principal="assistant", trust=Trust.GREEN)],
                                     gate_decision=GateDecision(action=GateAction.auto_save, reason="naive")), "naive:save")
        else:
            ws.gate.process(cands, spans, res.model)

    items = list(zip(q["haystack_dates"], q["haystack_sessions"], strict=False))
    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(one, items))


def answer_and_judge(ws: Workspace, q: dict) -> dict:
    hits = ws.store.recall(q["question"], k=15)
    mems = "\n".join(f"- {m.content}" for m, _ in hits)
    ans = ws.router.complete(
        "chat", [{"role": "system", "content": ANSWER_SYSTEM.format(qdate=q.get("question_date", ""))},
                 {"role": "user", "content": f"MEMORIES:\n{mems}\n\nQUESTION: {q['question']}"}],
        task="lme.answer", max_tokens=300, mock_input={"memories": [m.content for m, _ in hits]}, budget=ws.budget).text
    qtype = "abstention" if q["question_id"].endswith("_abs") else q["question_type"]
    tmpl = JUDGE.get(qtype, JUDGE["default"])
    label = "Rubric" if qtype == "single-session-preference" else ("Explanation" if qtype == "abstention" else "Correct Answer")
    j = ws.router.complete(
        "planner", [{"role": "system", "content": tmpl + " Reply JSON {\"correct\": true|false}."},
                    {"role": "user", "content": f"Question: {q['question']}\n\n{label}: {q['answer']}\n\nModel Response: {ans}"}],
        task="lme.judge", schema=JUDGE_SCHEMA, max_tokens=60, thinking=False,
        mock_input={"gold": q["answer"], "answer": ans}, budget=ws.budget)
    return {"question_id": q["question_id"], "type": qtype, "answer": ans[:500], "gold": str(q["answer"])[:300],
            "correct": bool((j.data or {}).get("correct")), "memories_recalled": len(hits)}


def run_one(settings, router, cache, config: str, q: dict) -> dict:
    ws = Workspace(Path(tempfile.mkdtemp(prefix="vouch-lme-")), settings, router, cache, AgentConfig.named(config))
    try:
        ingest(ws, q)
        r = answer_and_judge(ws, q)
        r["config"], r["cost"] = config, ws.usage_summary()["total_cost"]
        return r
    except Exception as e:
        return {"question_id": q["question_id"], "config": config, "error": f"{type(e).__name__}: {e}", "correct": False}
    finally:
        ws.destroy()


def run_lme(settings, router, cache, n: int = 100, configs=("vouch-full", "naive"), workers: int = 4) -> dict:
    qs = load(n)
    sessions = sum(len(q["haystack_sessions"]) for q in qs)
    print(f"LongMemEval_s: {len(qs)} questions, {sessions} sessions per config "
          f"(~{sessions * 3500 * len(configs) / 1e6:.1f}M input tokens total)")
    out = {}
    for cfg in configs:
        with cf.ThreadPoolExecutor(max_workers=workers) as ex:
            rows = list(ex.map(lambda q, c=cfg: run_one(settings, router, cache, c, q), qs))
        by_type = defaultdict(list)
        for r in rows:
            by_type[r.get("type", "?")].append(r["correct"])
        out[cfg] = {"accuracy": round(sum(r["correct"] for r in rows) / max(1, len(rows)), 4), "n": len(rows),
                    "by_type": {t: round(sum(v) / len(v), 4) for t, v in by_type.items()},
                    "errors": sum(1 for r in rows if r.get("error")),
                    "cost_usd": round(sum(r.get("cost", 0) or 0 for r in rows), 4), "rows": rows}
    return out


def main() -> None:
    from vouch.config import Settings
    from vouch.web.tavily import TavilyCache

    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--configs", default="vouch-full,naive")
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    s = Settings()
    r = Router(s)
    r.discover()
    res = run_lme(s, r, TavilyCache(ROOT / "data" / "eval-tavily-cache.db"), a.n, a.configs.split(","), a.workers)
    out = ROOT / "evals" / "results" / ("mock" if s.mock else "") / "longmemeval.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(res, indent=1), encoding="utf-8")
    print({k: {kk: vv for kk, vv in v.items() if kk != "rows"} for k, v in res.items()})


if __name__ == "__main__":
    main()
