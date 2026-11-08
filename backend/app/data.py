"""Fetch, normalize (hourly, local time) and cache GridStatus data.

Cache: SQLite, one row per (dataset-query key, local date). Past days are cached
forever; today/yesterday expire after CACHE_TTL_RECENT seconds (data still arriving).
Offline: if the API errors, times out or rate-limits, fall back to the bundled
snapshots in backend/snapshots/*.json.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import logging
import os
import sqlite3
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .regions import REGIONS, Region, Source

log = logging.getLogger("data")

BASE = Path(__file__).resolve().parent.parent
CACHE_PATH = Path(os.environ.get("CACHE_DIR", BASE / "cache")) / "gridstatus_cache.sqlite"
SNAPSHOT_DIR = BASE / "snapshots"
CACHE_TTL_RECENT = int(os.environ.get("CACHE_TTL_RECENT", "600"))
API_TIMEOUT_S = float(os.environ.get("API_TIMEOUT_S", "25"))
CIRCUIT_OPEN_S = 60  # after a failure, don't retry live API for this long

_lock = threading.Lock()
_circuit_open_until = 0.0
_last_error: str | None = None
_executor = cf.ThreadPoolExecutor(max_workers=4)


class DataUnavailable(Exception):
    pass


# --------------------------------------------------------------------------- cache
def _db() -> sqlite3.Connection:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(CACHE_PATH, timeout=10)
    con.execute(
        "CREATE TABLE IF NOT EXISTS cache (key TEXT, day TEXT, payload TEXT, fetched_at REAL, PRIMARY KEY (key, day))"
    )
    return con


def _cache_get(key: str, days: list[str], today: date) -> dict[str, tuple[dict, float]]:
    if not days:
        return {}
    with _lock, _db() as con:
        q = f"SELECT day, payload, fetched_at FROM cache WHERE key=? AND day IN ({','.join('?' * len(days))})"
        rows = con.execute(q, [key, *days]).fetchall()
    out = {}
    for day, payload, fetched_at in rows:
        recent = date.fromisoformat(day) >= today - timedelta(days=1)
        if recent and time.time() - fetched_at > CACHE_TTL_RECENT:
            continue
        out[day] = (json.loads(payload), fetched_at)
    return out


def _cache_put(key: str, items: dict[str, dict], fetched_at: float) -> None:
    with _lock, _db() as con:
        con.executemany(
            "INSERT OR REPLACE INTO cache (key, day, payload, fetched_at) VALUES (?,?,?,?)",
            [(key, d, json.dumps(p), fetched_at) for d, p in items.items()],
        )


# --------------------------------------------------------------------------- API
_client = None


def _get_client():
    global _client
    if _client is None:
        from gridstatusio import GridStatusClient

        if not os.environ.get("GRIDSTATUS_API_KEY"):
            raise DataUnavailable("GRIDSTATUS_API_KEY is not set")
        # Few retries, short backoff: on stage we'd rather fall back to the snapshot fast.
        _client = GridStatusClient(max_retries=1, base_delay=1.0)
    return _client


def _group_key(src: Source, cols: tuple[str, ...]) -> str:
    return f"{src.dataset}|{','.join(sorted(cols))}|{src.filter_value or ''}|{'h' if src.resample else 'raw'}"


def _fetch_range(src: Source, cols: tuple[str, ...], tz: str, d0: date, d1: date) -> dict[str, dict]:
    """Fetch [d0, d1) local days; return {day: {col: [24 hourly values]}}."""
    import pandas as pd

    kw = dict(
        start=d0.isoformat(),
        end=d1.isoformat(),
        timezone=tz,
        columns=["interval_start_utc", *cols],
        verbose=False,
    )
    if src.filter_column:
        kw.update(filter_column=src.filter_column, filter_value=src.filter_value)
    if src.resample:
        kw.update(resample="1 hour")
    df = _get_client().get_dataset(src.dataset, **kw)
    out: dict[str, dict] = {}
    if df is None or len(df) == 0:
        return out
    ts = pd.to_datetime(df["interval_start_utc"], utc=True).dt.tz_convert(tz)
    df = df.assign(_day=ts.dt.strftime("%Y-%m-%d"), _hour=ts.dt.hour)
    # mean per local clock hour (5-min -> hourly; also merges the repeated hour on DST fall-back)
    g = df.groupby(["_day", "_hour"])[list(cols)].mean()
    for (day, hour), row in g.iterrows():
        rec = out.setdefault(day, {c: [None] * 24 for c in cols})
        for c in cols:
            v = row[c]
            rec[c][int(hour)] = None if pd.isna(v) else round(float(v), 3)
    return out


def _with_timeout(fn, *args):
    global _circuit_open_until, _last_error
    if time.time() < _circuit_open_until:
        raise DataUnavailable(f"live API paused after recent failure: {_last_error}")
    fut = _executor.submit(fn, *args)
    try:
        return fut.result(timeout=API_TIMEOUT_S)
    except Exception as e:  # timeout, HTTP 429, network...
        _last_error = f"{type(e).__name__}: {e}"[:300]
        _circuit_open_until = time.time() + CIRCUIT_OPEN_S
        log.warning("GridStatus API failed: %s", _last_error)
        raise DataUnavailable(_last_error) from e


def _contiguous_ranges(days: list[date]) -> list[tuple[date, date]]:
    days = sorted(days)
    ranges, start, prev = [], days[0], days[0]
    for d in days[1:]:
        if (d - prev).days > 1:
            ranges.append((start, prev + timedelta(days=1)))
            start = d
        prev = d
    ranges.append((start, prev + timedelta(days=1)))
    return ranges


def _fetch_group(region: Region, src: Source, cols: tuple[str, ...], days: list[date], today: date):
    """Return ({day: {col: [24]}}, oldest fetched_at, used_cache_only)."""
    key = _group_key(src, cols)
    day_strs = [d.isoformat() for d in days]
    cached = _cache_get(key, day_strs, today)
    missing = [d for d in days if d.isoformat() not in cached and d <= today]
    result = {d: p for d, (p, _) in cached.items()}
    fetched = [t for _, t in cached.values()]
    if missing:
        now = time.time()
        for d0, d1 in _contiguous_ranges(missing):
            got = _with_timeout(_fetch_range, src, cols, region.tz, d0, d1)
            # days with no data still get cached (as empty) so we don't refetch them forever
            items = {d.isoformat(): got.get(d.isoformat(), {c: [None] * 24 for c in cols})
                     for d in missing if d0 <= d < d1}
            _cache_put(key, items, now)
            result.update(items)
            fetched.append(now)
    return result, (min(fetched) if fetched else None), not missing


# --------------------------------------------------------------------------- assemble
def _sum_cols(rec: dict | None, cols: tuple[str, ...], clip0: bool = False) -> list[float | None]:
    out: list[float | None] = []
    for h in range(24):
        vals = [rec[c][h] for c in cols if rec and rec.get(c) and rec[c][h] is not None]
        if not vals:
            out.append(None)
        else:
            v = sum(vals)
            out.append(max(0.0, v) if clip0 else v)
    return out


def _variables(region: Region) -> dict[str, Source | None]:
    return {"load": region.load, "solar": region.solar, "wind": region.wind,
            "curtailment": region.curtailment, "lmp": region.lmp}


def _assemble_live(region: Region, days: list[date], today: date) -> tuple[dict[str, dict], float | None, bool]:
    # group variables sharing a dataset query (e.g. solar + wind from one fuel-mix call)
    groups: dict[tuple, list[tuple[str, Source]]] = {}
    for var, src in _variables(region).items():
        if src:
            groups.setdefault((src.dataset, src.filter_value, src.resample), []).append((var, src))
    per_var: dict[str, dict] = {}
    fetched_times, all_cached = [], True
    for members in groups.values():
        cols = tuple(sorted({c for _, s in members for c in s.columns}))
        data, ft, from_cache = _fetch_group(region, members[0][1], cols, days, today)
        all_cached &= from_cache
        if ft:
            fetched_times.append(ft)
        for var, src in members:
            per_var[var] = {d: _sum_cols(data.get(d), src.columns, clip0=(var in ("solar", "wind", "curtailment")))
                            for d in [x.isoformat() for x in days]}
    out = {}
    for d in [x.isoformat() for x in days]:
        load = per_var["load"][d]
        solar = per_var["solar"][d] if "solar" in per_var else [0.0] * 24
        wind = per_var["wind"][d] if "wind" in per_var else [0.0] * 24
        net = [None if l is None else round(l - (s or 0) - (w or 0), 3) for l, s, w in zip(load, solar, wind)]
        out[d] = {
            "date": d, "load": load, "solar": solar, "wind": wind, "net": net,
            "curtailment": per_var.get("curtailment", {}).get(d) if region.curtailment else None,
            "lmp": per_var.get("lmp", {}).get(d) if region.lmp else None,
        }
    return out, (min(fetched_times) if fetched_times else None), all_cached


def _load_snapshot(region_id: str) -> dict | None:
    p = SNAPSHOT_DIR / f"{region_id}.json"
    return json.loads(p.read_text()) if p.exists() else None


def today_local(region: Region) -> date:
    return datetime.now(ZoneInfo(region.tz)).date()


def get_days(region_id: str, days: list[date], force_offline: bool = False) -> dict:
    """Return {"days": [DaySeries...], "meta": {...}} for the requested local dates."""
    region = REGIONS[region_id]
    today = today_local(region)
    meta = {
        "region": region_id,
        "tz": region.tz,
        "sources": {k: (s.dataset + (f" @ {s.filter_value}" if s.filter_value else "")) if s else None
                    for k, s in _variables(region).items()},
        "provider": "GridStatus.io Hosted API",
    }
    err = None
    if not force_offline and os.environ.get("OFFLINE_MODE", "0") != "1":
        try:
            series, fetched_at, all_cached = _assemble_live(region, days, today)
            meta.update(mode="cache" if all_cached else "live",
                        fetched_at=datetime.fromtimestamp(fetched_at).astimezone().isoformat() if fetched_at else None)
            return {"days": [series[d.isoformat()] for d in days], "meta": meta}
        except DataUnavailable as e:
            err = str(e)
        except Exception as e:  # never crash the demo on bad data
            log.exception("assemble failed")
            err = f"{type(e).__name__}: {e}"
    snap = _load_snapshot(region_id)
    if snap:
        have = [snap["days"][d.isoformat()] for d in days if d.isoformat() in snap["days"]]
        if have:
            meta.update(mode="snapshot", fetched_at=snap["generated_at"], error=err,
                        snapshot_coverage=f"{len(have)}/{len(days)} days")
            return {"days": have, "meta": meta}
    raise DataUnavailable(err or "offline mode and no snapshot for this region/date")


def build_snapshot(region_id: str, end: date, n_days: int) -> dict:
    """Used by scripts/make_snapshots.py: n_days ending at `end` (inclusive)."""
    days = [end - timedelta(days=i) for i in range(n_days - 1, -1, -1)]
    res = get_days(region_id, days)
    if res["meta"]["mode"] == "snapshot":
        raise RuntimeError("refusing to build a snapshot from a snapshot")
    return {
        "region": region_id,
        "generated_at": datetime.now().astimezone().isoformat(),
        "sources": res["meta"]["sources"],
        "days": {d["date"]: d for d in res["days"]},
    }
