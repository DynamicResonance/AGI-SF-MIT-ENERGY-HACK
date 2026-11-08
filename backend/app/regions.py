"""Region -> GridStatus dataset mapping.

Every dataset ID and column here was verified against the live GridStatus API
(list_datasets + sample pulls) on 2026-11-08 — see scripts/discover.py and NOTES.md.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Source:
    dataset: str
    columns: tuple[str, ...]          # summed together to form the variable
    resample: bool = True             # 5-min data -> ask API for hourly means
    filter_column: str | None = None
    filter_value: str | None = None
    # "mw": hourly mean MW (== MWh in that hour); "mwh": already hourly MWh totals
    unit: str = "mw"


@dataclass(frozen=True)
class Region:
    id: str
    label: str
    tz: str
    load: Source
    solar: Source | None
    wind: Source | None
    curtailment: Source | None
    lmp: Source | None
    lmp_label: str | None
    default_date: str                 # chosen from data, see scripts/default_days.py
    default_date_reason: str
    notes: list[str] = field(default_factory=list)


def _da(dataset: str, col: str, loc: str) -> Source:
    return Source(dataset, (col,), resample=False, filter_column="location", filter_value=loc)


REGIONS: dict[str, Region] = {
    "CAISO": Region(
        id="CAISO",
        label="CAISO (West – California) · system-wide",
        tz="America/Los_Angeles",
        load=Source("caiso_load", ("load",)),
        solar=Source("caiso_fuel_mix", ("solar",)),
        wind=Source("caiso_fuel_mix", ("wind",)),
        curtailment=Source("caiso_curtailment_aggregated_hourly", ("total_curtailment_mwh",), resample=False, unit="mwh"),
        lmp=_da("caiso_lmp_day_ahead_hourly", "lmp", "TH_NP15_GEN-APND"),
        lmp_label="Day-ahead LMP, NP15 trading hub",
        default_date="2026-04-22",
        default_date_reason="Weekday with the highest CAISO curtailment in Mar–May 2026 (98.5 GWh; #2 overall after Sun 2026-05-17).",
        notes=[
            "System-wide CAISO balancing area. PG&E-only net load is not available: "
            "GridStatus publishes PG&E-TAC load but solar, wind and curtailment only system-wide.",
        ],
    ),
    "ERCOT": Region(
        id="ERCOT",
        label="ERCOT (Texas)",
        tz="America/Chicago",
        load=Source("ercot_load", ("load",)),
        solar=Source("ercot_fuel_mix", ("solar",)),
        wind=Source("ercot_fuel_mix", ("wind",)),
        curtailment=None,
        lmp=_da("ercot_spp_day_ahead_hourly", "spp", "HB_HUBAVG"),
        lmp_label="Day-ahead settlement point price, Hub Average",
        default_date="2026-03-18",
        default_date_reason="Weekday with the deepest midday net-load dip in Mar–May 2026 (min = 19.8% of evening peak).",
        notes=["ERCOT does not publish renewable curtailment in GridStatus; conservative layer shown as not reported."],
    ),
    "PJM": Region(
        id="PJM",
        label="PJM (Mid-Atlantic)",
        tz="America/New_York",
        load=Source("pjm_load", ("load",)),
        solar=Source("pjm_fuel_mix_hourly", ("solar",), resample=False),
        wind=Source("pjm_fuel_mix_hourly", ("wind",), resample=False),
        curtailment=None,
        lmp=_da("pjm_lmp_day_ahead_hourly", "lmp", "WESTERN HUB"),
        lmp_label="Day-ahead LMP, Western Hub",
        default_date="2026-05-18",
        default_date_reason="Weekday with the deepest midday net-load dip in Mar–May 2026 (min = 63.7% of evening peak — a shallow dip).",
        notes=["Fuel mix excludes behind-the-meter solar (already netted out of metered load)."],
    ),
    "MISO": Region(
        id="MISO",
        label="MISO (Midwest)",
        tz="America/Chicago",
        load=Source("miso_load", ("load",)),
        solar=Source("miso_fuel_mix", ("solar",)),
        wind=Source("miso_fuel_mix", ("wind",)),
        curtailment=None,
        lmp=_da("miso_lmp_day_ahead_hourly", "lmp", "INDIANA.HUB"),
        lmp_label="Day-ahead LMP, Indiana Hub",
        default_date="2026-03-13",
        default_date_reason="Weekday with the deepest midday net-load dip in Mar–May 2026, excl. Memorial Day (min = 60.2% of evening peak — shallow).",
    ),
    "SPP": Region(
        id="SPP",
        label="SPP (Great Plains)",
        tz="America/Chicago",
        load=Source("spp_load", ("load",)),
        solar=Source("spp_fuel_mix", ("solar",)),
        wind=Source("spp_fuel_mix", ("wind",)),
        curtailment=Source(
            "spp_ver_curtailments",
            ("wind_redispatch_curtailments", "wind_manual_curtailments", "wind_curtailed_for_energy",
             "solar_redispatch_curtailments", "solar_manual_curtailments", "solar_curtailed_for_energy"),
        ),
        lmp=_da("spp_lmp_day_ahead_hourly", "lmp", "SPPSOUTH_HUB"),
        lmp_label="Day-ahead LMP, SPP South Hub",
        default_date="2026-03-11",
        default_date_reason="Weekday with the highest SPP VER curtailment in Mar–May 2026 (204 GWh, mostly wind).",
        notes=["Curtailment = SPP VER curtailments (redispatch + manual + curtailed-for-energy, wind + solar), East + West."],
    ),
    "NYISO": Region(
        id="NYISO",
        label="NYISO (New York)",
        tz="America/New_York",
        load=Source("nyiso_load", ("load",)),
        solar=None,
        wind=Source("nyiso_fuel_mix", ("wind",)),
        curtailment=None,
        lmp=_da("nyiso_lmp_day_ahead_hourly", "lmp", "N.Y.C."),
        lmp_label="Day-ahead LMP, Zone J (N.Y.C.)",
        default_date="2026-05-18",
        default_date_reason="Weekday with the deepest midday net-load dip in Mar–May 2026 (min = 65.9% of evening peak — shallow).",
        notes=["NYISO fuel mix has no separate grid-scale solar column (it's inside 'other renewables'); "
               "net load here = load − wind only. Behind-the-meter solar is already netted out of load."],
    ),
    "ISONE": Region(
        id="ISONE",
        label="ISO-NE (New England)",
        tz="America/New_York",
        load=Source("isone_load", ("load",)),
        solar=Source("isone_fuel_mix", ("solar",)),
        wind=Source("isone_fuel_mix", ("wind",)),
        curtailment=None,
        lmp=_da("isone_lmp_day_ahead_hourly", "lmp", ".H.INTERNAL_HUB"),
        lmp_label="Day-ahead LMP, Internal Hub",
        default_date="2026-04-09",
        default_date_reason="Weekday with the deepest midday net-load dip in Mar–May 2026 (min = 40.0% of evening peak).",
        notes=["Fuel-mix solar is grid-connected only; most New England solar is behind the meter."],
    ),
}

REGION_ORDER = ["CAISO", "ERCOT", "PJM", "MISO", "SPP", "NYISO", "ISONE"]
