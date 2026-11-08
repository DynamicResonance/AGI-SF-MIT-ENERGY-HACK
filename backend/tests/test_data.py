import json
from datetime import date

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app import data
from app.regions import Source


class FakeClient:
    """Returns 5-min data: load=1000 at every interval, solar=100*hour in daytime."""

    def __init__(self, fail=False):
        self.fail = fail
        self.calls = 0

    def get_dataset(self, dataset, start, end, timezone, columns, **kw):
        self.calls += 1
        if self.fail:
            raise Exception("HTTP 429: Too Many Requests")
        idx = pd.date_range(pd.Timestamp(start, tz=timezone), pd.Timestamp(end, tz=timezone), freq="5min", inclusive="left")
        df = pd.DataFrame({"interval_start_utc": idx.tz_convert("UTC")})
        for c in columns[1:]:
            if c == "load":
                df[c] = 1000.0
            elif c in ("lmp", "spp"):
                df[c] = -2.0
            else:
                df[c] = [100.0 * t.hour if 8 <= t.hour < 17 else -5.0 for t in idx]
        return df


@pytest.fixture(autouse=True)
def tmp_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(data, "CACHE_PATH", tmp_path / "c.sqlite")
    monkeypatch.setattr(data, "SNAPSHOT_DIR", tmp_path / "snaps")
    monkeypatch.setattr(data, "_circuit_open_until", 0.0)
    monkeypatch.delenv("OFFLINE_MODE", raising=False)
    yield


def use(monkeypatch, client):
    monkeypatch.setattr(data, "_get_client", lambda: client)


def test_contiguous_ranges():
    ds = [date(2026, 4, d) for d in (1, 2, 3, 7, 8, 10)]
    assert data._contiguous_ranges(ds) == [
        (date(2026, 4, 1), date(2026, 4, 4)),
        (date(2026, 4, 7), date(2026, 4, 9)),
        (date(2026, 4, 10), date(2026, 4, 11)),
    ]


def test_fetch_range_hourly_local(monkeypatch):
    use(monkeypatch, FakeClient())
    out = data._fetch_range(Source("x", ("load",)), ("load",), "America/Los_Angeles", date(2026, 4, 22), date(2026, 4, 23))
    assert list(out) == ["2026-04-22"]
    assert out["2026-04-22"]["load"] == [1000.0] * 24


def test_dst_spring_forward_has_missing_hour(monkeypatch):
    use(monkeypatch, FakeClient())
    out = data._fetch_range(Source("x", ("load",)), ("load",), "America/Chicago", date(2026, 3, 8), date(2026, 3, 9))
    vals = out["2026-03-08"]["load"]
    assert vals[2] is None and sum(v is not None for v in vals) == 23


def test_get_days_live_then_cache_and_net_load(monkeypatch):
    fc = FakeClient()
    use(monkeypatch, fc)
    r = data.get_days("ERCOT", [date(2026, 3, 18)])
    assert r["meta"]["mode"] == "live"
    d = r["days"][0]
    assert d["solar"][3] == 0.0  # negative night solar clipped to 0
    assert d["net"][12] == 1000 - 1200 - 1200  # load - solar - wind
    assert d["curtailment"] is None  # ERCOT doesn't publish it
    assert d["lmp"] == [-2.0] * 24
    calls = fc.calls
    r2 = data.get_days("ERCOT", [date(2026, 3, 18)])
    assert r2["meta"]["mode"] == "cache" and fc.calls == calls


def test_falls_back_to_snapshot_on_api_failure(monkeypatch, tmp_path):
    use(monkeypatch, FakeClient(fail=True))
    snaps = tmp_path / "snaps"
    snaps.mkdir()
    day = {"date": "2026-04-22", "load": [1] * 24, "solar": [0] * 24, "wind": [0] * 24, "net": [1] * 24,
           "curtailment": [0] * 24, "lmp": [0] * 24}
    (snaps / "CAISO.json").write_text(json.dumps({"generated_at": "2026-11-08T00:00:00", "days": {"2026-04-22": day}}))
    r = data.get_days("CAISO", [date(2026, 4, 22)])
    assert r["meta"]["mode"] == "snapshot"
    assert "429" in r["meta"]["error"]
    assert r["days"][0] == day


def test_unavailable_without_snapshot(monkeypatch):
    use(monkeypatch, FakeClient(fail=True))
    with pytest.raises(data.DataUnavailable):
        data.get_days("PJM", [date(2026, 5, 18)])


def test_api_endpoints(monkeypatch):
    use(monkeypatch, FakeClient())
    from app.main import app

    c = TestClient(app)
    regs = c.get("/api/regions").json()["regions"]
    assert [r["id"] for r in regs][:2] == ["CAISO", "ERCOT"]
    assert regs[0]["label"] == "CAISO (West – California) · system-wide"
    assert all(r["default_date"] for r in regs)
    day = c.get("/api/day", params={"region": "CAISO", "date": "2026-04-22"}).json()
    assert len(day["day"]["net"]) == 24
    hist = c.get("/api/history", params={"region": "CAISO", "end": "2026-04-22", "days": 7}).json()
    assert [d["date"] for d in hist["days"]][-1] == "2026-04-22" and len(hist["days"]) == 7
    assert c.get("/api/day", params={"region": "XYZ"}).status_code == 404
