from gridstatusio import GridStatusClient
c = GridStatusClient()
for ds, tz, lt in [("miso_lmp_day_ahead_hourly","America/Chicago","Hub"),("nyiso_lmp_day_ahead_hourly","America/New_York","Zone"),("isone_lmp_day_ahead_hourly","America/New_York","HUB")]:
    df = c.get_dataset(ds, start="2026-04-22", end="2026-04-23", timezone=tz, verbose=False, columns=["interval_start_utc","location","location_type","lmp"], filter_column="location_type", filter_value=lt)
    print(ds, sorted(df.location.unique().tolist()))
