import type { DaySeries } from "./calc";

export interface RegionInfo {
  id: string;
  label: string;
  tz: string;
  default_date: string;
  default_date_reason: string;
  today: string;
  has_curtailment: boolean;
  has_lmp: boolean;
  has_solar: boolean;
  lmp_label: string | null;
  notes: string[];
}

export type DataMode = "live" | "cache" | "snapshot" | "browser-snapshot";

export interface Meta {
  region: string;
  tz: string;
  mode: DataMode;
  fetched_at: string | null;
  sources: Record<string, string | null>;
  provider: string;
  error?: string | null;
  snapshot_coverage?: string;
}

export interface DaysResponse {
  days: DaySeries[];
  meta: Meta;
}
