"""Agent-loop configuration. Every number is an ASSUMPTION with a rationale.

Score = "penalized cost" in USD for one day of deferred agent work. LOWER IS BETTER.
  score = energy cost at hub LMP
        + PEAK_PENALTY      x MWh run during the evening peak hours
        + MISS_PENALTY      x jobs that finish after their deadline (or got an invalid start)
        + CAP_PENALTY       x MWh above the site's max MW in any hour
        - WINDOW_CREDIT     x MWh run inside the midday surplus window
        - CURTAIL_CREDIT    x curtailed renewable MWh absorbed (min(job MW, curtailment) per hour)
"""

# Mirrors frontend/lib/assumptions.ts defaults (70B-class model on H100). Overridable per request.
DEFAULT_ASSUMPTIONS = {"pue": 1.2, "kw_per_gpu": 1.3, "tokens_per_sec_per_gpu": 2700, "utilization": 0.7}

# Mirrors WINDOW_RULES in frontend/lib/assumptions.ts.
EVENING_PEAK_HOURS = (16, 23)   # search range for the net-load peak
EVENING_PRICE_HOURS = (17, 21)  # hours penalized as "evening peak" for the scheduler
DIP_SEARCH_HOURS = (6, 19)
FALLBACK_WINDOW = (9, 14)
DIP_THRESHOLD_PCT = 50

# Site limit: a ~300 MW AI campus. Chosen so that (a) the status-quo plan is feasible
# (its busiest hour is ~275 MW, so the baseline pays no cap penalty and the comparison
# is fair) and (b) the ~1.7 GWh/day synthetic workload can NOT all be crammed into the
# few cheapest / most-curtailed midday hours -> the agent must trade off.
MAX_MW = 300.0

# $/MWh adder for running at the evening peak: stands in for capacity cost + peaker
# emissions (a ~0.5 tCO2/MWh peaker at ~$100/t).
PEAK_PENALTY = 50.0
# Per missed deadline: deliberately dominant, so no plan can "buy" a miss with cheap energy.
MISS_PENALTY = 25_000.0
# Per MWh over the site's MW cap: physically infeasible, so heavily penalized.
CAP_PENALTY = 1_000.0
# Credit per MWh landed in the midday surplus window (the thesis being tested).
WINDOW_CREDIT = 10.0
# Credit per curtailed renewable MWh absorbed: avoided waste, ~0.4 tCO2/MWh x $50/t.
CURTAIL_CREDIT = 20.0

DEFAULT_ITERATIONS = 8
SEED = 7
