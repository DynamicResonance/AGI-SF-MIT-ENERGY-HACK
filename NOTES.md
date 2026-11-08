# NOTES: data choices, gaps, and what to be ready to defend

Verified against the live GridStatus API on 2026-11-08 (`scripts/discover.py` lists all 548 datasets;
`scripts/sample.py` / `check_others.py` / `check_hubs.py` pulled sample days).
All series are normalized to **hourly averages in local time** (MW averaged over the hour = MWh in that hour).

## Datasets per ISO

| ISO | Load | Solar / wind | Curtailment | Price (day-ahead, hourly) | Default demo day |
|---|---|---|---|---|---|
| CAISO | `caiso_load` (5-min) | `caiso_fuel_mix` | `caiso_curtailment_aggregated_hourly` (`total_curtailment_mwh`) | `caiso_lmp_day_ahead_hourly` @ TH_NP15_GEN-APND | 2026-04-22 (Wed) |
| ERCOT | `ercot_load` | `ercot_fuel_mix` | **none** | `ercot_spp_day_ahead_hourly` @ HB_HUBAVG (SPP, not LMP) | 2026-03-18 (Wed) |
| PJM | `pjm_load` | `pjm_fuel_mix_hourly` | **none** | `pjm_lmp_day_ahead_hourly` @ WESTERN HUB | 2026-05-18 (Mon) |
| MISO | `miso_load` | `miso_fuel_mix` | **none** | `miso_lmp_day_ahead_hourly` @ INDIANA.HUB | 2026-03-13 (Fri) |
| SPP | `spp_load` | `spp_fuel_mix` | `spp_ver_curtailments` (sum of 6 cols, MW) | `spp_lmp_day_ahead_hourly` @ SPPSOUTH_HUB | 2026-03-11 (Wed) |
| NYISO | `nyiso_load` | wind only, `nyiso_fuel_mix` (**no solar column**) | **none** | `nyiso_lmp_day_ahead_hourly` @ N.Y.C. (zone J) | 2026-05-18 (Mon) |
| ISO-NE | `isone_load` | `isone_fuel_mix` | **none** | `isone_lmp_day_ahead_hourly` @ .H.INTERNAL_HUB | 2026-04-09 (Thu) |

- **Price data exists for all 7 ISOs.** Curtailment only for **CAISO and SPP**; the others show the conservative layer as
  "not reported", never as zero.
- **PG&E:** `caiso_load_hourly` has PG&E-TAC *load*, but solar, wind and curtailment are only published system-wide, so a
  PG&E net-load duck cannot be computed from data. We show **CAISO system-wide**, labeled as such (your decision).
- **ERCOT curtailment:** not offered. An HSL − actual-generation proxy is possible but also captures outages and derates,
  so we left it out (your decision).
- **Default days** are chosen from data by `scripts/default_days.py`: the weekday (holidays excluded) in Mar–May 2026 with the
  highest curtailment where it is published, otherwise the deepest midday dip (min net load ÷ evening peak). Weekends were
  excluded on purpose (low load looks cherry-picked). For reference, CAISO's absolute max was Sun 2026-05-17 (112.9 GWh curtailed).
- **Shallow ducks:** PJM, MISO and NYISO bottom out at ~60–66% of the evening peak, above the 50% threshold. The app says
  "no dip below threshold" and uses the 09:00–14:00 fallback window instead of hiding it.

## Numbers to be ready to defend

1. **Annualization: 30 spring days × 365 overstates.** CAISO conservative layer: 30 days ending 2026-04-22 → **14.1 TWh/yr**;
   365 days → **3.6 TWh/yr** (all-hours curtailment that year: 3.7 TWh). Optimistic layer: 78 vs 72 TWh/yr. ERCOT optimistic: 53 vs 37 TWh/yr.
   *Quote the 365-day number* (selector: "Annualize over last 365 days"). Default is 30 as specified; consider switching it.
2. **The optimistic layer is a ceiling, not a forecast.** "Evening-peak minus midday net load" assumes the dispatchable fleet that
   serves the evening peak could serve the same MW at midday: no must-run, ramp, transmission or reserve limits, and
   imports/batteries are treated as part of the dispatchable fleet. It is "capacity already built", not "free energy".
3. **Curtailment ≠ deliverable to a data center.** Much CAISO curtailment is *local* (transmission-constrained: 59.9 of 112.9 GWh on
   2026-05-17). Absorbing it requires load at the right node.
4. **Tokens/sec per GPU (2,700)** is from MLPerf Inference v4.0 Llama-2-70B *offline* on 8×H100 (~21.8k tok/s). It's a batch benchmark;
   utilization (0.7) is the real-world haircut. Token count scales linearly with both, so ±30% here is ±30% on tokens/$.
5. **kW/GPU (1.3)** is DGX H100 *max* system power ÷ 8, deliberately conservative. **PUE 1.2.** **$0.60/M tokens** sits between DeepInfra
   (~$0.40/M output) and Together (~$0.88–1.04/M) for Llama-3.3-70B. Third-party price trackers disagree; check provider pages before the talk.
6. **Prices are day-ahead hub prices** (hourly). Real-time prices go negative more often; we chose DA for completeness and stability.
   ERCOT's is a settlement point price (SPP), labeled as such.
7. **Net load = load − solar − wind** from fuel mix. Behind-the-meter solar is already netted out of metered load (CAISO, NYISO, ISO-NE
   publish it separately; not added back). Small negative night-time solar readings are clipped to 0.
8. **SPP curtailment looks large** (13.9 TWh over the 365-day snapshot; 204 GWh on 2026-03-11). It's the sum of SPP's VER
   curtailment columns (redispatch + manual + for-energy), mostly wind at night. Verify the column semantics with SPP before quoting SPP totals.

## Agent loop

- **The workload is synthetic** (labeled on screen): 50 jobs, fixed seed. Energy = tokens × kWh/token from the same assumptions as the
  calculator (2.29e-7 kWh/token → ~1.7 GWh/day total). Four kinds: overnight research, inbox digests, code review, deep reasoning.
- **Grid data is real** (same data layer). The simulator/scorer is deterministic Python; Claude never scores itself.
- **Score** = penalized cost in $ (lower is better): energy at hub price + $50/MWh in 17–21h + $25k per missed deadline
  + $1k/MWh over the 300 MW site cap − $10/MWh in the dip window − $20/MWh of curtailment absorbed. Weights and rationale:
  `backend/app/agent/config.py`. They're policy choices; the breakdown table shows each component, so the audience can
  discount the credits and look at energy cost alone.
- **Baseline** = run every job the moment it becomes available (status quo). It's feasible by construction (busiest hour ~275 MW < 300 MW cap).
- Proposer: `claude-opus-5-5`, structured output (Pydantic schema), effort `medium`, server-side refusal fallback on. Each iteration
  gets the full job list, the hourly grid table, the score history, the best and previous plans, and the previous plan's violations.

## Chart choice

LMP is drawn in an **aligned panel under the duck chart** rather than on a secondary y-axis. Two scales on one plot invite false
"these lines cross" readings, especially from the back of a room. Easy to change if you prefer the dual axis.

## Known limits

- Hourly granularity (5-min data is averaged); "hours at ≤ $0" counts DA hours, not 5-min intervals.
- DST days: the spring-forward day has 23 hours (one null hour); fall-back merges the repeated hour.
- The GridStatus client's `list_datasets()` hits `/v1/datasets/`, which 307-redirects to `http://` (fails behind strict proxies);
  `scripts/discover.py` calls `/v1/datasets` directly.
