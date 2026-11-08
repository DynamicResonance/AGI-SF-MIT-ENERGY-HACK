"""PROPOSER: Claude proposes a schedule (start hour per job) from the job list, the
day's hourly grid summary, and feedback (scores + breakdowns) from earlier iterations.

Uses structured outputs (Pydantic schema) so the reply is always parseable JSON.
"""
from __future__ import annotations

import json
import os

from pydantic import BaseModel, Field

from . import config as C
from .jobs import Job

MODEL = os.environ.get("PROPOSER_MODEL", "claude-opus-5-5")
EFFORT = os.environ.get("PROPOSER_EFFORT", "medium")


class JobStart(BaseModel):
    job_id: str
    start_hour: int


class Plan(BaseModel):
    rationale: str = Field(description="2-4 sentences: what you changed vs. the previous plan and why.")
    starts: list[JobStart]


class ProposerUnavailable(Exception):
    pass


SYSTEM = f"""You are a scheduling agent for a fleet of deferrable AI inference jobs at one data-center site.
Your goal: choose a start hour (integer, local clock 0-23) for EVERY job to MINIMIZE the score of a
deterministic simulator that replays your plan on real hourly grid data. Lower score is better.

Score (USD, lower is better) =
  energy cost at the hourly hub price (MWh x $/MWh; negative prices pay you)
  + ${C.PEAK_PENALTY:.0f} per MWh run during the evening peak hours {C.EVENING_PRICE_HOURS[0]}:00-{C.EVENING_PRICE_HOURS[1]}:00
  + ${C.MISS_PENALTY:,.0f} per job that misses its deadline or has an invalid start
  + ${C.CAP_PENALTY:,.0f} per MWh above the site cap in any hour
  - ${C.WINDOW_CREDIT:.0f} per MWh run inside the midday surplus window
  - ${C.CURTAIL_CREDIT:.0f} per MWh of curtailed renewables absorbed (per hour: min(site MW, curtailed MWh))

Hard rules for each job: start_hour >= earliest_start, and start_hour + duration_h <= deadline (and <= 24).
A job draws its constant MW for every hour it runs. The sum over all jobs in any hour must stay <= the site cap.
Return every job id exactly once. Use the feedback from earlier iterations: keep what worked, fix violations,
and try a concrete improvement each round."""


def _grid_table(day: dict, window: tuple[int, int]) -> str:
    rows = ["hour | net_load_GW | price_$/MWh | curtailed_MWh | in_window | evening_peak"]
    es, ee = C.EVENING_PRICE_HOURS
    for h in range(24):
        n = day["net"][h]
        p = (day.get("lmp") or [None] * 24)[h]
        c = day["curtailment"][h] if day.get("curtailment") else None
        rows.append(f"{h:02d} | {'' if n is None else f'{n / 1000:.1f}'} | {'' if p is None else f'{p:.2f}'} | "
                    f"{'n/a' if c is None else f'{c:.0f}'} | {'Y' if window[0] <= h < window[1] else ''} | "
                    f"{'Y' if es <= h < ee else ''}")
    return "\n".join(rows)


def _jobs_table(jobs: list[Job]) -> str:
    rows = ["job_id | kind | MW | duration_h | earliest_start | deadline"]
    rows += [f"{j.id} | {j.kind} | {j.mw:.2f} | {j.duration_h} | {j.earliest_start} | {j.deadline}" for j in jobs]
    return "\n".join(rows)


def _feedback(history: list[dict]) -> str:
    if not history:
        return "No previous iterations yet."
    lines = ["Score history (lower is better):"]
    for h in history:
        b = h["breakdown"]
        lines.append(
            f"- {h['label']}: score {h['score']:,.0f} | energy ${b['energy_cost_usd']:,.0f} | peak MWh {b['evening_peak_mwh']:.0f} | "
            f"window MWh {b['window_mwh']:.0f} | curtailed absorbed {b['curtailed_mwh_absorbed']:.0f} | "
            f"missed {b['deadlines_missed']} | cap overflow MWh {b['cap_overflow_mwh']:.1f}")
    best = min(history, key=lambda h: h["score"])
    last = history[-1]
    out = "\n".join(lines)
    out += f"\n\nBest so far: {best['label']} (score {best['score']:,.0f}). Its starts: {json.dumps(best['starts'])}"
    if last is not best:
        out += f"\n\nPrevious plan ({last['label']}) starts: {json.dumps(last['starts'])}"
    out += f"\nPrevious plan hourly site MW: {[round(x) for x in last['hourly_mw']]}"
    if last["violations"]:
        out += "\nViolations in previous plan:\n" + "\n".join(f"  * {v}" for v in last["violations"][:20])
    return out


def build_prompt(jobs: list[Job], day: dict, window: tuple[int, int], max_mw: float, history: list[dict]) -> str:
    return (
        f"Site cap: {max_mw:.0f} MW. Midday surplus window: {window[0]:02d}:00-{window[1]:02d}:00.\n\n"
        f"HOURLY GRID DATA for {day['date']} (real data):\n{_grid_table(day, window)}\n\n"
        f"JOBS ({len(jobs)}):\n{_jobs_table(jobs)}\n\n"
        f"FEEDBACK FROM THE SIMULATOR:\n{_feedback(history)}\n\n"
        "Propose the next schedule."
    )


def propose(jobs: list[Job], day: dict, window: tuple[int, int], max_mw: float, history: list[dict]) -> tuple[Plan, dict]:
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        raise ProposerUnavailable("ANTHROPIC_API_KEY is not set")
    import anthropic

    # Explicit base URL: ignore any ANTHROPIC_BASE_URL meant for other tooling on the host.
    client = anthropic.Anthropic(base_url=os.environ.get("PROPOSER_BASE_URL", "https://api.anthropic.com"),
                                 timeout=300.0, max_retries=2)
    try:
        resp = client.beta.messages.parse(
            model=MODEL,
            max_tokens=16000,
            system=SYSTEM,
            messages=[{"role": "user", "content": build_prompt(jobs, day, window, max_mw, history)}],
            output_format=Plan,
            output_config={"effort": EFFORT},
            # Server-side refusal fallback (routes by refusal category).
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.RateLimitError as e:
        raise ProposerUnavailable(f"rate limited: {e}") from e
    except anthropic.APIStatusError as e:
        raise ProposerUnavailable(f"API error {e.status_code}: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise ProposerUnavailable(f"connection error: {e}") from e
    if resp.stop_reason == "refusal" or resp.parsed_output is None:
        raise ProposerUnavailable(f"no plan returned (stop_reason={resp.stop_reason})")
    usage = {"model": resp.model, "input_tokens": resp.usage.input_tokens, "output_tokens": resp.usage.output_tokens}
    return resp.parsed_output, usage
