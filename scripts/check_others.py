import json
from gridstatusio import GridStatusClient
ds = {d["id"]: d for d in json.load(open("scripts/datasets_all.json"))}
c = GridStatusClient()
CAND = {
 "pjm":   ("America/New_York", ["pjm_load","pjm_fuel_mix_hourly","pjm_lmp_day_ahead_hourly"]),
 "miso":  ("America/Chicago", ["miso_load","miso_fuel_mix","miso_lmp_day_ahead_hourly"]),
 "spp":   ("America/Chicago", ["spp_load","spp_fuel_mix","spp_ver_curtailments","spp_lmp_day_ahead_hourly"]),
 "nyiso": ("America/New_York", ["nyiso_load","nyiso_fuel_mix","nyiso_lmp_day_ahead_hourly"]),
 "isone": ("America/New_York", ["isone_load","isone_fuel_mix","isone_lmp_day_ahead_hourly"]),
}
for iso,(tz,ids) in CAND.items():
    for i in ids:
        d = ds[i]; cols=[c_["name"] for c_ in d["all_columns"]]
        kw = {}
        if "lmp" in i: kw = dict(columns=["interval_start_utc","location","location_type","lmp"])
        df = c.get_dataset(i, start="2026-04-22", end="2026-04-23", timezone=tz, verbose=False, **kw)
        step = (df.interval_end_utc-df.interval_start_utc).mode()[0] if len(df) else None
        print(f"\n== {i} rows={len(df)} step={step} sub={d.get('subseries_index_column')}")
        if "lmp" in i:
            print("  location_types:", df.location_type.unique()[:10].tolist())
            hubs = df[df.location_type.str.contains("hub|Hub|HUB", na=False)].location.unique().tolist()
            print("  hubs:", hubs[:15])
            if not hubs: print("  zones sample:", df.location.unique()[:15].tolist())
        else:
            print("  cols:", cols)
