"""Record real agent-loop runs (Claude proposer) for offline replay on stage.

Usage: ANTHROPIC_API_KEY=... python scripts/record_agent_run.py [REGION ...] [--iterations N]
Writes backend/agent_runs/<REGION>_<DATE>.json (served by /api/agent/cached) and copies
it to frontend/public/agent_runs/ (browser fallback if the backend is down).
"""
import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, "backend")
from app.agent.loop import run_loop, run_path  # noqa: E402
from app.regions import REGIONS  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("regions", nargs="*", default=["CAISO", "ERCOT"])
ap.add_argument("--iterations", type=int, default=8)
ap.add_argument("--date", default=None, help="default: each region's default demo date")
args = ap.parse_args()

for rid in args.regions:
    d = args.date or REGIONS[rid].default_date
    print(f"== {rid} {d}", flush=True)
    ok = False
    for ev in run_loop(rid, d, args.iterations):
        t = ev["type"]
        if t == "start":
            print(f"  baseline score ${ev['baseline']['score']:,.0f}  window {ev['window']}  data={ev['data_mode']}", flush=True)
        elif t == "iteration":
            print(f"  it {ev['iteration']}: ${ev['score']:,.0f}  best ${ev['best_score']:,.0f}  "
                  f"missed={ev['breakdown']['deadlines_missed']} over_cap={ev['breakdown']['cap_overflow_mwh']:.1f}  | {ev['rationale'][:110]}", flush=True)
        elif t == "done":
            print(f"  done: {ev['improvement_pct']}% better than baseline in {ev['elapsed_s']}s", flush=True)
            ok = True
        elif t == "error":
            print(f"  ERROR: {ev['message']}", flush=True)
    if ok:
        dst = Path("frontend/public/agent_runs")
        dst.mkdir(parents=True, exist_ok=True)
        shutil.copy(run_path(rid, d), dst / run_path(rid, d).name)
        print(f"  saved {run_path(rid, d)} (+ copy in {dst})")
