"""Recompute derived summary fields of recorded runs from their own scores (no re-scoring)."""
import json, shutil, sys
from pathlib import Path
for p in sys.argv[1:]:
    r = json.loads(Path(p).read_text())
    b, s = r["baseline"]["score"], r["best"]["score"]
    r["improvement_usd"] = round(b - s, 2)
    r["improvement_pct"] = round(100 * (b - s) / b, 1) if b > 0 and s >= 0 else None
    Path(p).write_text(json.dumps(r, separators=(",", ":")))
    shutil.copy(p, Path("frontend/public/agent_runs") / Path(p).name)
    print(Path(p).name, "baseline", b, "best", s, "improvement_usd", r["improvement_usd"], "pct", r["improvement_pct"])
