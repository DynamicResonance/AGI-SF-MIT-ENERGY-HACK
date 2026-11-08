import pandas as pd
from gridstatusio import GridStatusClient
pd.set_option("display.width", 200); pd.set_option("display.max_columns", 20)
c = GridStatusClient()
D0, D1 = "2025-04-15", "2025-04-16"
def g(ds, tz, **kw):
    df = c.get_dataset(ds, start=D0, end=D1, timezone=tz, verbose=False, **kw)
    print(f"\n### {ds}: {len(df)} rows"); return df
pt, ct = "America/Los_Angeles", "America/Chicago"
df = g("caiso_load_hourly", pt); print(df.groupby("tac_area_name")["load"].agg(["count","mean"]).round(0))
df = g("caiso_load", pt); print(df.head(3)); print("interval:", df.interval_start_local.diff().mode()[0])
df = g("caiso_fuel_mix", pt, columns=["interval_start_utc","solar","wind"]); print(df.head(3))
df = g("caiso_curtailment_aggregated_hourly", pt); print(df[df.total_curtailment_mwh>0].head(4)); print("daily total MWh:", df.total_curtailment_mwh.sum())
df = g("caiso_lmp_day_ahead_hourly", pt, filter_column="location_type", filter_value="Trading Hub"); print(df.location.unique())
df = g("ercot_load", ct); print(df.head(2)); print("interval:", df.interval_start_local.diff().mode()[0])
df = g("ercot_fuel_mix", ct, columns=["interval_start_utc","solar","wind"]); print(df.head(2))
df = g("ercot_net_load", ct); print(df.head(2))
df = g("ercot_spp_day_ahead_hourly", ct, filter_column="location_type", filter_value="Trading Hub"); print(df.location.unique())
