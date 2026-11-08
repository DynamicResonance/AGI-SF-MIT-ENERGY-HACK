"""Build bundled offline snapshots: 365 days ending at each region's default date.
Usage: python scripts/make_snapshots.py [REGION ...]   (default: all regions)
Writes backend/snapshots/<REGION>.json and copies to frontend/public/snapshots/."""
import json, shutil, sys, time
from datetime import date
from pathlib import Path
sys.path.insert(0, "backend")
from app.data import build_snapshot
from app.regions import REGIONS, REGION_ORDER

out_b, out_f = Path("backend/snapshots"), Path("frontend/public/snapshots")
out_b.mkdir(parents=True, exist_ok=True); out_f.mkdir(parents=True, exist_ok=True)
for rid in (sys.argv[1:] or REGION_ORDER):
    for attempt in range(8):
        try:
            snap = build_snapshot(rid, date.fromisoformat(REGIONS[rid].default_date), 365); break
        except Exception as e:
            print(f"{rid}: {str(e)[:120]} -> waiting 65s", flush=True); time.sleep(65)
    else:
        sys.exit(f"{rid}: failed")
    p = out_b / f"{rid}.json"
    p.write_text(json.dumps(snap, separators=(",", ":")))
    shutil.copy(p, out_f / p.name)
    print(f"{rid}: {len(snap['days'])} days, {p.stat().st_size/1e6:.2f} MB", flush=True)

import runpy; runpy.run_path("scripts/export_regions.py")
