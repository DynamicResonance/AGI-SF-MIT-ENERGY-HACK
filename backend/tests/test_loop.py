"""Agent loop wiring test with a deterministic stub proposer (no network, no LLM)."""
import json

from app.agent import loop as L
from app.agent.proposer import JobStart, Plan, ProposerUnavailable


def fake_day():
    net = [5000 if 9 <= h <= 13 else 30000 if h == 19 else 20000 for h in range(24)]
    return {"date": "2026-04-22", "load": [30000] * 24, "solar": [0] * 24, "wind": [0] * 24, "net": net,
            "lmp": [-5 if 9 <= h <= 13 else 80 if 17 <= h < 21 else 30 for h in range(24)],
            "curtailment": [1000 if 9 <= h <= 13 else 0 for h in range(24)]}


def patch_data(monkeypatch, tmp_path):
    monkeypatch.setattr(L, "get_days", lambda region, days: {"days": [fake_day()], "meta": {"mode": "live", "sources": {}}})
    monkeypatch.setattr(L, "RUNS_DIR", tmp_path)


def stub_proposer(jobs, day, window, max_mw, history):
    """Learns from feedback: each round moves more flexible jobs into the window (latest feasible >= window start)."""
    k = len(history)  # 1 on first call
    starts = []
    flex = [j for j in jobs if j.deadline - j.duration_h >= window[0]]
    for idx, j in enumerate(jobs):
        s = j.earliest_start
        if j in flex[: k * 10]:
            s = max(j.earliest_start, min(window[0] + idx % 3, j.deadline - j.duration_h))
        starts.append(JobStart(job_id=j.id, start_hour=s))
    return Plan(rationale=f"moved {min(k * 10, len(flex))} jobs into the window", starts=starts), {"model": "stub"}


def test_loop_improves_and_saves(monkeypatch, tmp_path):
    patch_data(monkeypatch, tmp_path)
    events = list(L.run_loop("CAISO", "2026-04-22", iterations=4, proposer=stub_proposer))
    kinds = [e["type"] for e in events]
    assert kinds[0] == "start" and kinds[-1] == "done"
    its = [e for e in events if e["type"] == "iteration"]
    assert len(its) == 4
    base = events[0]["baseline"]["score"]
    assert its[-1]["best_score"] < base
    saved = json.loads((tmp_path / "CAISO_2026-04-22.json").read_text())
    assert len(saved["iterations"]) == 4 and saved["improvement_usd"] > 0
    # score crosses zero with the credits -> a % would be meaningless, so it is None
    assert saved["improvement_pct"] is None or saved["best"]["score"] >= 0
    assert len(saved["synthetic_jobs"]) == 50


def test_loop_reports_proposer_failure(monkeypatch, tmp_path):
    patch_data(monkeypatch, tmp_path)

    def broken(*a):
        raise ProposerUnavailable("ANTHROPIC_API_KEY is not set")

    events = list(L.run_loop("CAISO", "2026-04-22", iterations=2, proposer=broken))
    assert events[-1]["type"] == "error" and "ANTHROPIC_API_KEY" in events[-1]["message"]
    assert not (tmp_path / "CAISO_2026-04-22.json").exists()
