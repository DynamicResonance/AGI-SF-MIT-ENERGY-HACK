"""Pick each region's default demo day from data (Mar–May of the latest spring).
Rule: weekday with the highest midday curtailment if the ISO publishes curtailment,
otherwise the weekday with the deepest midday net-load dip (min net load in 06–19h
as % of evening peak 16–23h)."""
import sys, time
from datetime import date, timedelta
sys.path.insert(0, "backend")
from app.data import get_days
from app.regions import REGIONS, REGION_ORDER

HOLIDAYS = {"2026-05-25"}  # Memorial Day (low-load holiday, not representative)
start, end = date(2026, 3, 1), date(2026, 5, 31)
days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
for rid in REGION_ORDER:
    for attempt in range(6):
        try:
            res = get_days(rid, days)["days"]; break
        except Exception as e:
            print(f"  {rid}: {e} -> waiting 65s"); time.sleep(65)
    rows = []
    for d in res:
        dd = date.fromisoformat(d["date"])
        net = d["net"]
        if dd.isoformat() in HOLIDAYS or dd.weekday() >= 5 or sum(v is None for v in net) > 2: continue
        peak = max(v for v in net[16:23] if v is not None)
        mid = min(v for v in net[6:19] if v is not None)
        curt = sum(v or 0 for v in d["curtailment"]) if d["curtailment"] else None
        rows.append((d["date"], round(100 * mid / peak, 1), curt))
    has_c = REGIONS[rid].curtailment is not None
    best = max(rows, key=lambda r: r[2]) if has_c else min(rows, key=lambda r: r[1])
    print(f"{rid:6} default={best[0]}  dip_min_pct={best[1]}  curtailment_mwh={None if best[2] is None else round(best[2])}  ({len(rows)} weekdays)")
