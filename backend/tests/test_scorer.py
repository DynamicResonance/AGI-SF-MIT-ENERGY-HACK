"""Hand-checked tests for the agent-loop simulator/scorer."""
import pytest

from app.agent import config as C
from app.agent.jobs import Job, generate_jobs, kwh_per_token
from app.agent.simulator import baseline_starts, detect_dip_window, simulate


def job(id, mwh, dur, earliest, deadline):
    return Job(id=id, kind="test", description="", tokens=0, kwh=mwh * 1000, duration_h=dur,
               earliest_start=earliest, deadline=deadline)


def grid():
    """Same shape as the hand-checked example in frontend/lib/calc.test.ts."""
    net = [5000 if 9 <= h <= 13 else 30000 if h == 19 else 20000 for h in range(24)]
    lmp = [{9: -5, 10: -5, 11: 0, 12: 10, 13: 10, 17: 80, 18: 80, 19: 80, 20: 80}.get(h, 30) for h in range(24)]
    curt = [1000 if 9 <= h <= 13 else 0 for h in range(24)]
    return {"net": net, "lmp": lmp, "curtailment": curt}


def test_dip_window_parity_with_ts_calc():
    assert detect_dip_window(grid()["net"]) == (9, 14, True)
    assert detect_dip_window([20000] * 24) == (9, 14, False)
    net = [20000] * 24
    net[19], net[7], net[11], net[12] = 30000, 10000, 2000, 3000
    assert detect_dip_window(net)[:2] == (11, 13)


def test_hand_checked_score():
    # A: 20 MWh over 2 h (10 MW) at 09-11.  B: 30 MWh in 1 h (30 MW) at 18 (evening).
    jobs = [job("A", 20, 2, 0, 24), job("B", 30, 1, 0, 24)]
    r = simulate(jobs, {"A": 9, "B": 18}, grid())
    b = r.breakdown
    # energy cost = 10*(-5) + 10*(-5) + 30*80 = 2300
    assert b["energy_cost_usd"] == pytest.approx(2300)
    # evening [17,21): 30 MWh -> 50 * 30 = 1500
    assert b["evening_peak_mwh"] == pytest.approx(30)
    assert b["peak_penalty_usd"] == pytest.approx(1500)
    # window [9,14): 20 MWh -> -10 * 20 = -200 ; curtailment absorbed min(10,1000)*2 = 20 -> -400
    assert b["window_mwh"] == pytest.approx(20)
    assert b["curtailed_mwh_absorbed"] == pytest.approx(20)
    assert b["window_credit_usd"] == pytest.approx(-200)
    assert b["curtailment_credit_usd"] == pytest.approx(-400)
    assert b["deadlines_missed"] == 0 and b["cap_overflow_mwh"] == 0
    assert r.score == pytest.approx(2300 + 1500 - 200 - 400)  # 3200
    assert r.hourly_mw[9] == pytest.approx(10) and r.hourly_mw[18] == pytest.approx(30)


def test_shifting_into_dip_improves_score():
    jobs = [job("A", 20, 2, 0, 24), job("B", 30, 1, 0, 24)]
    bad = simulate(jobs, {"A": 9, "B": 18}, grid()).score
    good = simulate(jobs, {"A": 9, "B": 11}, grid()).score
    assert good < bad


def test_missed_deadline_and_invalid_start():
    jobs = [job("A", 10, 2, 8, 12)]
    late = simulate(jobs, {"A": 11}, grid())  # ends 13 > 12
    assert late.breakdown["deadlines_missed"] == 1
    assert late.breakdown["deadline_penalty_usd"] == C.MISS_PENALTY
    early = simulate(jobs, {"A": 5}, grid())  # before earliest -> runs at 8, counted missed
    assert early.breakdown["deadlines_missed"] == 1 and early.effective_starts["A"] == 8
    missing = simulate(jobs, {}, grid())
    assert missing.breakdown["deadlines_missed"] == 1
    assert any("invalid start" in v for v in missing.violations)


def test_cap_overflow():
    jobs = [job("A", 200, 1, 0, 24), job("B", 100, 1, 0, 24)]
    r = simulate(jobs, {"A": 10, "B": 10}, grid(), max_mw=250)
    assert r.breakdown["cap_overflow_mwh"] == pytest.approx(50)
    assert r.breakdown["cap_penalty_usd"] == pytest.approx(50 * C.CAP_PENALTY)


def test_missing_lmp_and_curtailment_handled():
    g = {"net": grid()["net"], "lmp": None, "curtailment": None}
    r = simulate([job("A", 10, 1, 0, 24)], {"A": 10}, g)
    assert r.breakdown["energy_cost_usd"] == 0 and r.breakdown["curtailed_mwh_absorbed"] == 0


def test_synthetic_jobs_deterministic_and_feasible_baseline():
    a, b = generate_jobs(), generate_jobs()
    assert [j.to_dict() for j in a] == [j.to_dict() for j in b]
    assert len(a) == 50 and {j.kind for j in a} == {"overnight_research", "inbox_digest", "code_review", "deep_reasoning"}
    for j in a:
        assert j.earliest_start + j.duration_h <= j.deadline <= 24
        assert j.kwh == pytest.approx(j.tokens * kwh_per_token(), rel=1e-3)
    r = simulate(a, baseline_starts(a), grid())
    assert r.breakdown["deadlines_missed"] == 0
    assert r.breakdown["cap_overflow_mwh"] == 0  # status quo must be feasible for a fair comparison
