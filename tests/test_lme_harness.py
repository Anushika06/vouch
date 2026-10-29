"""Pipeline test for the LongMemEval harness on a tiny synthetic item (no download, mock models)."""

import evals.longmemeval.run_lme as lme

Q = {"question_id": "t1", "question_type": "single-session-user", "question": "What is the name of my cat?",
     "answer": "Luna", "question_date": "2023/06/01",
     "haystack_dates": ["2023/05/20", "2023/05/21"],
     "haystack_sessions": [[{"role": "user", "content": "Remember that my cat is named Luna."},
                            {"role": "assistant", "content": "Lovely name!"}],
                           [{"role": "user", "content": "I prefer green tea."}, {"role": "assistant", "content": "Noted."}]]}


def test_lme_pipeline(monkeypatch, settings, router, tmp_path):
    from vouch.web.tavily import TavilyCache

    monkeypatch.setattr(lme, "load", lambda n, seed=7: [Q])
    res = lme.run_lme(settings, router, TavilyCache(tmp_path / "c.db"), n=1, configs=["vouch-full", "naive"], workers=1)
    for cfg in ("vouch-full", "naive"):
        assert res[cfg]["n"] == 1 and res[cfg]["errors"] == 0
        assert res[cfg]["accuracy"] == 1.0
