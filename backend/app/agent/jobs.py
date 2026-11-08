"""SYNTHETIC deferred-agent workload (clearly labeled as such in the UI).

Deterministic for a given seed. Energy is derived from tokens:
  kWh/token = kW per GPU x PUE / (tokens/sec per GPU x 3600 x utilization)
Hours are local clock hours of the selected day; a job occupies [start, start+duration).
"""
from __future__ import annotations

import random
from dataclasses import asdict, dataclass

from .config import DEFAULT_ASSUMPTIONS, SEED


@dataclass(frozen=True)
class Job:
    id: str
    kind: str
    description: str
    tokens: float
    kwh: float
    duration_h: int
    earliest_start: int   # hour the job becomes available
    deadline: int         # hour by which it must be finished (exclusive end <= deadline)

    @property
    def mw(self) -> float:
        return self.kwh / 1000.0 / self.duration_h

    def to_dict(self) -> dict:
        return {**asdict(self), "mw": round(self.mw, 3)}


def kwh_per_token(a: dict | None = None) -> float:
    a = {**DEFAULT_ASSUMPTIONS, **(a or {})}
    return a["kw_per_gpu"] * a["pue"] / (a["tokens_per_sec_per_gpu"] * 3600 * a["utilization"])


# kind, count, description, tokens range (billions), duration range, earliest range, deadline rule
KINDS = [
    ("overnight_research", 10, "Overnight research sweep (literature + web agents)", (200, 600), (3, 6), (0, 0), "eod"),
    ("inbox_digest", 15, "Inbox / Slack digest for a team", (20, 60), (1, 1), (5, 7), ("rel", 4, 8)),
    ("code_review", 15, "Batch code review of the day's PRs", (30, 100), (1, 2), (8, 15), ("rel", 5, 9)),
    ("deep_reasoning", 10, "Deep reasoning pass (planning / eval / analysis)", (150, 400), (2, 4), (0, 10), "eod"),
]


def generate_jobs(seed: int = SEED, assumptions: dict | None = None) -> list[Job]:
    rng = random.Random(seed)
    kpt = kwh_per_token(assumptions)
    jobs: list[Job] = []
    for kind, count, desc, (tlo, thi), (dlo, dhi), (elo, ehi), rule in KINDS:
        for i in range(count):
            tokens = rng.uniform(tlo, thi) * 1e9
            dur = rng.randint(dlo, dhi)
            earliest = rng.randint(elo, ehi)
            if rule == "eod":
                deadline = 24
            else:
                deadline = min(24, earliest + max(dur, rng.randint(rule[1], rule[2])))
            jobs.append(Job(
                id=f"{kind[:2].upper()}{i + 1:02d}", kind=kind, description=desc,
                tokens=round(tokens), kwh=round(tokens * kpt, 1), duration_h=dur,
                earliest_start=earliest, deadline=deadline,
            ))
    return jobs
