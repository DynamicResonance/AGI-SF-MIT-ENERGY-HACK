import pandas as pd
from gridstatusio import GridStatusClient
c = GridStatusClient(); tz="America/Los_Angeles"
a = c.get_dataset("caiso_curtailment_aggregated_hourly", start="2026-05-17", end="2026-05-18", timezone=tz, verbose=False)
print(a[["interval_start_local","solar_curtailment_mwh","solar_curtailment_mw","total_curtailment_mwh"]].iloc[6:18].to_string())
r = c.get_dataset("caiso_curtailment", start="2026-05-17", end="2026-05-18", timezone=tz, verbose=False)
print("\nraw rows:", len(r), "interval:", (r.interval_end_local-r.interval_start_local).value_counts().head(3).to_dict())
print(r.groupby(["curtailment_type","curtailment_reason","fuel_type"]).curtailment_mwh.sum().round(0))
print("raw total MWh:", round(r.curtailment_mwh.sum()))
fm = c.get_dataset("caiso_fuel_mix", start="2026-05-17", end="2026-05-18", timezone=tz, verbose=False, columns=["interval_start_utc","solar"])
print("solar gen MWh that day:", round(fm.solar.clip(lower=0).sum()/12), " peak MW:", fm.solar.max())
