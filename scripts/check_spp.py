from gridstatusio import GridStatusClient
import pandas as pd; pd.set_option("display.width",220)
c = GridStatusClient()
df = c.get_dataset("spp_ver_curtailments", start="2026-04-22", end="2026-04-23", timezone="America/Chicago", verbose=False)
print(df.iloc[::24, 1:].to_string())
r = c.get_dataset("caiso_load", start="2026-04-22", end="2026-04-23", timezone="America/Los_Angeles", verbose=False, resample="1 hour")
print(len(r)); print(r.head(3))
