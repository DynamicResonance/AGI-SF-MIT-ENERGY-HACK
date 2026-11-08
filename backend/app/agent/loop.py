"""The agent loop: PROPOSE (Claude) -> SIMULATE/VERIFY (deterministic) -> SCORE -> feed back.

Yields JSON-serializable events so the API can stream them (NDJSON) to the UI, and
saves a completed run to agent_runs/<REGION>_<DATE>.json for offline replay.
"""
from __future__ import annotations

import json
import time
from datetime import date, datetime
from pathlib import Path
from typing import Callable, Iterator

from ..data import get_days
from . import config as C
from .jobs import generate_jobs
from .proposer import ProposerUnavailable, propose
from .simulator import baseline_starts, detect_dip_window, simulate

RUNS_DIR = Path(__file__).resolve().parent.parent.parent / "agent_runs"


def run_path(region: str, day: str) -> Path:
    return RUNS_DIR / f"{region}_{day}.json"


def run_loop(region: str, day_str: str, iterations: int = C.DEFAULT_ITERATIONS, assumptions: dict | None = None,
             proposer: Callable = propose, save: bool = True) -> Iterator[dict]:
    t0 = time.time()
    res = get_days(region, [date.fromisoformat(day_str)])
    day = res["days"][0]
    if sum(v is not None for v in day["net"]) < 22:
        yield {"type": "error", "message": f"{day_str} is incomplete ({sum(v is not None for v in day['net'])}/24 hours); pick a past day."}
        return
    ws, we, detected = detect_dip_window(day["net"])
    jobs = generate_jobs(assumptions=assumptions)

    base = simulate(jobs, baseline_starts(jobs), day, (ws, we))
    history = [{"label": "baseline", **base.to_dict()}]
    run = {
        "region": region, "date": day_str, "data_mode": res["meta"]["mode"], "sources": res["meta"]["sources"],
        "window": [ws, we], "window_detected": detected, "max_mw": C.MAX_MW,
        "weights": {k: getattr(C, k) for k in ("PEAK_PENALTY", "MISS_PENALTY", "CAP_PENALTY", "WINDOW_CREDIT", "CURTAIL_CREDIT")},
        "synthetic_jobs": [j.to_dict() for j in jobs],
        "grid": {k: day[k] for k in ("net", "load", "solar", "lmp", "curtailment")},
        "baseline": history[0], "iterations": [], "started_at": datetime.now().astimezone().isoformat(),
    }
    yield {"type": "start", **{k: run[k] for k in ("region", "date", "window", "max_mw", "synthetic_jobs", "grid", "weights", "data_mode")},
           "baseline": history[0], "iterations_planned": iterations}

    best = history[0]
    for i in range(1, iterations + 1):
        yield {"type": "thinking", "iteration": i}
        try:
            plan, usage = proposer(jobs, day, (ws, we), C.MAX_MW, history)
        except ProposerUnavailable as e:
            yield {"type": "error", "message": f"proposer unavailable: {e}"}
            return
        starts = {s.job_id: s.start_hour for s in plan.starts}
        sim = simulate(jobs, starts, day, (ws, we))
        entry = {"label": f"iteration {i}", "iteration": i, "rationale": plan.rationale, "usage": usage, **sim.to_dict()}
        history.append(entry)
        improved = sim.score < best["score"]
        if improved:
            best = entry
        run["iterations"].append(entry)
        yield {"type": "iteration", **entry, "improved": improved, "best_score": best["score"]}

    run.update(best=best, finished_at=datetime.now().astimezone().isoformat(), elapsed_s=round(time.time() - t0, 1),
               improvement_pct=round(100 * (history[0]["score"] - best["score"]) / abs(history[0]["score"]), 1)
               if history[0]["score"] else None)
    if save:
        RUNS_DIR.mkdir(exist_ok=True)
        run_path(region, day_str).write_text(json.dumps(run, separators=(",", ":")))
    yield {"type": "done", "best": best, "improvement_pct": run["improvement_pct"], "elapsed_s": run["elapsed_s"],
           "saved": save}
