from __future__ import annotations

import logging
import os
from datetime import date, timedelta

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .data import DataUnavailable, get_days, today_local
from .regions import REGION_ORDER, REGIONS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="Midday Surplus → Tokens API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["GET"],
    allow_headers=["*"],
)

MAX_HISTORY_DAYS = 365


def _region(region: str):
    r = REGIONS.get(region.upper())
    if not r:
        raise HTTPException(404, f"unknown region {region}; choose from {REGION_ORDER}")
    return r


def _parse_date(region, d: str) -> date:
    if d in ("latest", "today"):
        return today_local(region)
    try:
        return date.fromisoformat(d)
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD or 'latest'")


@app.get("/api/health")
def health():
    return {"ok": True, "api_key_configured": bool(os.environ.get("GRIDSTATUS_API_KEY")),
            "offline_mode": os.environ.get("OFFLINE_MODE", "0") == "1"}


@app.get("/api/regions")
def regions():
    out = []
    for rid in REGION_ORDER:
        r = REGIONS[rid]
        out.append({
            "id": r.id, "label": r.label, "tz": r.tz,
            "default_date": r.default_date, "default_date_reason": r.default_date_reason,
            "today": today_local(r).isoformat(),
            "has_curtailment": r.curtailment is not None, "has_lmp": r.lmp is not None,
            "has_solar": r.solar is not None,
            "lmp_label": r.lmp_label, "notes": r.notes,
        })
    return {"regions": out}


@app.get("/api/day")
def day(region: str = "CAISO", date_: str = Query("default", alias="date"), offline: bool = False):
    r = _region(region)
    d = date.fromisoformat(r.default_date) if date_ == "default" else _parse_date(r, date_)
    try:
        res = get_days(r.id, [d], force_offline=offline)
    except DataUnavailable as e:
        raise HTTPException(503, f"data unavailable: {e}")
    return {"day": res["days"][0], "meta": res["meta"]}


@app.get("/api/agent/status")
def agent_status():
    from .agent.proposer import EFFORT, MODEL

    return {"proposer_configured": bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")),
            "model": MODEL, "effort": EFFORT}


@app.get("/api/agent/run")
def agent_run(region: str = "CAISO", date_: str = Query("default", alias="date"), iterations: int = 8):
    """Streams NDJSON events: start, thinking, iteration..., done | error."""
    import json

    from fastapi.responses import StreamingResponse

    from .agent.loop import run_loop

    r = _region(region)
    d = r.default_date if date_ == "default" else _parse_date(r, date_).isoformat()
    n = max(1, min(iterations, 20))

    def gen():
        try:
            for ev in run_loop(r.id, d, n):
                yield json.dumps(ev) + "\n"
        except DataUnavailable as e:
            yield json.dumps({"type": "error", "message": f"grid data unavailable: {e}"}) + "\n"
        except Exception as e:  # keep the stream well-formed for the UI
            logging.exception("agent run failed")
            yield json.dumps({"type": "error", "message": f"{type(e).__name__}: {e}"}) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/agent/cached")
def agent_cached(region: str = "CAISO", date_: str = Query("default", alias="date")):
    import json

    from .agent.loop import run_path

    r = _region(region)
    d = r.default_date if date_ == "default" else date_
    p = run_path(r.id, d)
    if not p.exists():
        raise HTTPException(404, f"no recorded agent run for {r.id} {d}")
    return json.loads(p.read_text())


@app.get("/api/history")
def history(region: str = "CAISO", end: str = "default", days: int = 30, offline: bool = False):
    r = _region(region)
    e = date.fromisoformat(r.default_date) if end == "default" else _parse_date(r, end)
    n = max(1, min(days, MAX_HISTORY_DAYS))
    ds = [e - timedelta(days=i) for i in range(n - 1, -1, -1)]
    try:
        res = get_days(r.id, ds, force_offline=offline)
    except DataUnavailable as ex:
        raise HTTPException(503, f"data unavailable: {ex}")
    return res
