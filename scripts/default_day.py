import pandas as pd
from gridstatusio import GridStatusClient
c = GridStatusClient()
S, E = "2026-03-01", "2026-06-01"
cu = c.get_dataset("caiso_curtailment_aggregated_hourly", start=S, end=E, timezone="America/Los_Angeles", verbose=False)
cu["d"] = cu.interval_start_local.dt.date
print("CAISO top curtailment days (MWh):"); print(cu.groupby("d").total_curtailment_mwh.sum().nlargest(5))
nl = c.get_dataset("ercot_net_load", start=S, end=E, timezone="America/Chicago", verbose=False)
nl["d"] = nl.interval_start_local.dt.date; nl["h"] = nl.interval_start_local.dt.hour
g = nl.groupby("d")
dip = pd.DataFrame({"evening_peak": nl[nl.h.between(17,22)].groupby("d").net_load.max(),
                    "midday_min": nl[nl.h.between(9,15)].groupby("d").net_load.min()})
dip["min_pct_of_peak"] = (dip.midday_min/dip.evening_peak*100).round(1)
print("\nERCOT deepest dip days (midday min net load as % of evening peak):"); print(dip.nsmallest(5,"min_pct_of_peak"))
