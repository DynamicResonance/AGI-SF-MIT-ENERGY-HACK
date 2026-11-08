/**
 * Data access with layered fallback, so the demo never shows a blank screen:
 *   1. Backend (/api/*): live GridStatus -> SQLite cache -> server snapshot
 *   2. If the backend itself is unreachable: static /snapshots/<REGION>.json in this app
 */
import type { DaySeries } from "./calc";
import type { DaysResponse, Meta, RegionInfo } from "./types";

type Snapshot = { generated_at: string; sources: Record<string, string>; days: Record<string, DaySeries> };
const snapCache = new Map<string, Promise<Snapshot>>();

function loadSnapshot(region: string): Promise<Snapshot> {
  if (!snapCache.has(region)) {
    const p = fetch(`/snapshots/${region}.json`).then((r) => {
      if (!r.ok) throw new Error(`no bundled snapshot for ${region}`);
      return r.json();
    });
    p.catch(() => snapCache.delete(region));
    snapCache.set(region, p);
  }
  return snapCache.get(region)!;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function browserSnapshot(region: string, end: string, days: number, why: string): Promise<DaysResponse> {
  const snap = await loadSnapshot(region);
  const dates = Array.from({ length: days }, (_, i) => addDays(end, i - days + 1));
  const have = dates.map((d) => snap.days[d]).filter(Boolean);
  if (!have.length) throw new Error(`Data unavailable (${why}) and the bundled snapshot doesn't cover ${end}.`);
  const meta: Meta = {
    region,
    tz: "",
    mode: "browser-snapshot",
    fetched_at: snap.generated_at,
    sources: snap.sources,
    provider: "GridStatus.io Hosted API (bundled snapshot)",
    error: why,
    snapshot_coverage: `${have.length}/${days} days`,
  };
  return { days: have, meta };
}

export async function fetchRegions(): Promise<RegionInfo[]> {
  try {
    const r = await fetch("/api/regions", { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()).regions;
  } catch {
    const r = await fetch("/snapshots/regions.json");
    return (await r.json()).regions;
  }
}

/** `days` trailing days ending at `end` (inclusive). */
export async function fetchDays(region: string, end: string, days: number, offline: boolean): Promise<DaysResponse> {
  const qs = new URLSearchParams({ region, end, days: String(days), offline: offline ? "true" : "false" });
  try {
    const r = await fetch(`/api/history?${qs}`, { signal: AbortSignal.timeout(50_000) });
    const body = await r.json();
    if (!r.ok) throw new Error(body.detail ?? `HTTP ${r.status}`);
    return body as DaysResponse;
  } catch (e) {
    return browserSnapshot(region, end, days, (e as Error).message);
  }
}
