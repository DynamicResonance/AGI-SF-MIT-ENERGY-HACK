"""Deterministic simulator + verifier + scorer (no LLM).

Replays a schedule (job_id -> start hour) on one day of real hourly grid data and
returns one score (penalized cost, USD, lower is better) plus its breakdown.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import config as C
from .jobs import Job


def _num(v) -> bool:
    return isinstance(v, (int, float))


def detect_dip_window(net: list, threshold_pct: float = C.DIP_THRESHOLD_PCT) -> tuple[int, int, bool]:
    """Python port of detectDipWindow in frontend/lib/calc.ts (same rules, parity-tested)."""
    ps, pe = C.EVENING_PEAK_HOURS
    ss, se = C.DIP_SEARCH_HOURS
    peak_vals = [net[h] for h in range(ps, min(pe, len(net))) if _num(net[h])]
    if not peak_vals:
        return (*C.FALLBACK_WINDOW, False)
    thr = threshold_pct / 100 * max(peak_vals)

    def q(h: int) -> bool:
        return ss <= h < se and h < len(net) and _num(net[h]) and net[h] < thr

    cands = [h for h in range(ss, se) if q(h)]
    if not cands:
        return (*C.FALLBACK_WINDOW, False)
    m = min(cands, key=lambda h: (net[h], h))
    s, e = m, m + 1
    while q(s - 1):
        s -= 1
    while q(e):
        e += 1
    return s, e, True


@dataclass
class SimResult:
    score: float
    breakdown: dict
    hourly_mw: list[float]
    violations: list[str] = field(default_factory=list)
    effective_starts: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {"score": round(self.score, 2), "breakdown": self.breakdown,
                "hourly_mw": [round(x, 3) for x in self.hourly_mw],
                "violations": self.violations, "starts": self.effective_starts}


def baseline_starts(jobs: list[Job]) -> dict[str, int]:
    """Status quo: every job runs the moment it becomes available."""
    return {j.id: j.earliest_start for j in jobs}


def simulate(jobs: list[Job], starts: dict, day: dict, window: tuple[int, int] | None = None,
             max_mw: float = C.MAX_MW) -> SimResult:
    lmp = day.get("lmp") or [None] * 24
    curt = day.get("curtailment")
    if window is None:
        ws, we, _ = detect_dip_window(day["net"])
    else:
        ws, we = window
    hourly = [0.0] * 24
    violations: list[str] = []
    missed = 0
    eff: dict[str, int] = {}

    for j in jobs:
        s = starts.get(j.id)
        valid = isinstance(s, int) and not isinstance(s, bool)
        if not valid or s < j.earliest_start or s + j.duration_h > 24:
            violations.append(f"{j.id}: invalid start {s!r} (earliest {j.earliest_start}, duration {j.duration_h}h) "
                              f"-> ran at earliest start instead, counted as missed")
            s = j.earliest_start
            missed += 1
        elif s + j.duration_h > j.deadline:
            violations.append(f"{j.id}: finishes at {s + j.duration_h}:00, deadline {j.deadline}:00")
            missed += 1
        eff[j.id] = s
        for h in range(s, min(24, s + j.duration_h)):
            hourly[h] += j.mw

    unknown = set(starts) - {j.id for j in jobs}
    if unknown:
        violations.append(f"unknown job ids ignored: {sorted(unknown)[:5]}")

    es, ee = C.EVENING_PRICE_HOURS
    energy_cost = sum(mw * lmp[h] for h, mw in enumerate(hourly) if mw and _num(lmp[h]))
    window_mwh = sum(hourly[ws:we])
    peak_mwh = sum(hourly[es:ee])
    curt_abs = sum(min(mw, max(0.0, curt[h])) for h, mw in enumerate(hourly) if curt and _num(curt[h]))
    overflow = sum(max(0.0, mw - max_mw) for mw in hourly)
    overflow_hours = [h for h, mw in enumerate(hourly) if mw > max_mw + 1e-9]
    if overflow_hours:
        violations.append(f"over {max_mw:.0f} MW site cap at hours {overflow_hours}")
    total = sum(hourly)

    parts = {
        "energy_cost_usd": energy_cost,
        "peak_penalty_usd": C.PEAK_PENALTY * peak_mwh,
        "deadline_penalty_usd": C.MISS_PENALTY * missed,
        "cap_penalty_usd": C.CAP_PENALTY * overflow,
        "window_credit_usd": -C.WINDOW_CREDIT * window_mwh,
        "curtailment_credit_usd": -C.CURTAIL_CREDIT * curt_abs,
    }
    score = sum(parts.values())
    breakdown = {
        **{k: round(v, 2) for k, v in parts.items()},
        "total_mwh": round(total, 3),
        "window_mwh": round(window_mwh, 3),
        "window_share": round(window_mwh / total, 4) if total else 0.0,
        "evening_peak_mwh": round(peak_mwh, 3),
        "curtailed_mwh_absorbed": round(curt_abs, 3),
        "deadlines_missed": missed,
        "cap_overflow_mwh": round(overflow, 3),
        "avg_price_usd_per_mwh": round(energy_cost / total, 2) if total else None,
        "window": [ws, we],
        "max_mw": max_mw,
    }
    return SimResult(score=score, breakdown=breakdown, hourly_mw=hourly, violations=violations, effective_starts=eff)
