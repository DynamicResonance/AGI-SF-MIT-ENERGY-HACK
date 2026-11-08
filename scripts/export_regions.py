"""Export region metadata to frontend/public/snapshots/regions.json (browser offline fallback)."""
import json, sys
sys.path.insert(0, "backend")
from app.main import regions
json.dump(regions(), open("frontend/public/snapshots/regions.json", "w"), indent=1, ensure_ascii=False)
print("wrote regions.json")
