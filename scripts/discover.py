"""List GridStatus datasets relevant to load / fuel mix / curtailment / LMP per ISO.
Uses /v1/datasets (no trailing slash): the client's /datasets/ 307-redirects to http://."""
import json, os, re, requests
H = {"x-api-key": os.environ.get("GRIDSTATUS_API_KEY", "proxy-injected")}
out, page = [], 1
while True:
    r = requests.get("https://api.gridstatus.io/v1/datasets", headers=H,
                     params={"page": page, "page_size": 500}, timeout=60).json()
    out += r["data"]
    meta = r.get("meta", {})
    if not meta.get("hasNextPage"): break
    page += 1
json.dump(out, open("scripts/datasets_all.json", "w"), default=str)
print("total datasets:", len(out))
pat = re.compile(r"(load|fuel_mix|curtail|lmp|spp_|solar|wind)", re.I)
skip = re.compile(r"(node|bus|nodal|shadow|constraint|forecast_.*zone|_as_)", re.I)
for d in sorted(out, key=lambda d: d["id"]):
    if d.get("source") in {"caiso","ercot","pjm","miso","spp","nyiso","isone"} and pat.search(d["id"]) and not skip.search(d["id"]):
        print(f'{d["source"]:6} {d["id"]:58} {str(d.get("earliest_available_time_utc"))[:10]} -> {str(d.get("latest_available_time_utc"))[:10]}')
