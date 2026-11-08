"""Warm the SQLite cache for every region's default day + 365-day history.
Run shortly before a demo so live mode answers instantly. Waits out rate limits."""
import sys
import time
from datetime import date, timedelta

sys.path.insert(0, "backend")
from app.data import get_days  # noqa: E402
from app.regions import REGION_ORDER, REGIONS  # noqa: E402

for rid in REGION_ORDER:
    end = date.fromisoformat(REGIONS[rid].default_date)
    days = [end - timedelta(days=i) for i in range(364, -1, -1)]
    for _ in range(6):
        res = get_days(rid, days)
        if res["meta"]["mode"] != "snapshot":
            break
        print(f"{rid}: API unavailable ({res['meta'].get('error')}), waiting 65s", flush=True)
        time.sleep(65)
    print(f"{rid}: {res['meta']['mode']}", flush=True)
