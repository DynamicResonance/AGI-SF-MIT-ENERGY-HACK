"use client";
import type { Annualized, DayResult, TokenEconomics } from "@/lib/calc";
import { fmtBig, fmtEnergy, fmtPrice, fmtUsd } from "@/lib/format";
import { REFERENCE_DC_MW } from "@/lib/assumptions";

interface Props {
  result: DayResult;
  annual: Annualized | null;
  annualDays: number;
  annualLoading: boolean;
  hasCurtailment: boolean;
  presenter: boolean;
}

function Layer({ title, subtitle, t, annual, presenter, missing }: {
  title: string;
  subtitle: string;
  t: TokenEconomics | null;
  annual: TokenEconomics | null | undefined;
  presenter: boolean;
  missing?: string;
}) {
  const big = presenter ? "text-6xl" : "text-5xl";
  const mid = presenter ? "text-3xl" : "text-2xl";
  return (
    <div className="card p-5 flex flex-col gap-4">
      <div>
        <div className={`${presenter ? "text-2xl" : "text-xl"} font-semibold`}>{title}</div>
        <div className="muted text-sm">{subtitle}</div>
      </div>
      {!t ? (
        <div className="secondary text-lg py-6">{missing}</div>
      ) : (
        <>
          <div>
            <div className="muted text-sm uppercase tracking-wide">Energy in window</div>
            <div className={`${big} font-bold tabular`}>{fmtEnergy(t.facilityMwh)}</div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Tokens" value={fmtBig(t.tokens)} cls={mid} />
            <Stat label="Value at market price" value={fmtUsd(t.usd)} cls={mid} />
            <Stat label="GPU-hours" value={fmtBig(t.gpuHours)} cls={mid} />
            <Stat label={`${REFERENCE_DC_MW} MW data-center-days`} value={t.dataCenterDays.toFixed(1)} cls={mid} />
          </div>
          <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <div className="muted text-sm uppercase tracking-wide">Annualized</div>
            {annual ? (
              <div className={`${mid} font-semibold tabular`}>
                {fmtEnergy(annual.facilityMwh)} · {fmtBig(annual.tokens)} tokens · {fmtUsd(annual.usd)}
              </div>
            ) : (
              <div className="secondary">{annual === null ? "not available" : "…"}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <div>
      <div className="muted text-sm">{label}</div>
      <div className={`${cls} font-semibold tabular`}>{value}</div>
    </div>
  );
}

export default function BigNumbers({ result, annual, annualDays, annualLoading, hasCurtailment, presenter }: Props) {
  const p = result.prices;
  const annualNote = annualLoading
    ? `averaging the last ${annualDays} days…`
    : annual
      ? `Annualized = average of ${annual.daysUsed} complete day(s) ending on this date × 365${annual.daysUsed < annualDays ? ` (${annualDays - annual.daysUsed} missing/partial days excluded)` : ""}. A spring-only average overstates a full year: use 365 days for a defensible annual number.`
      : "";
  return (
    <div className="flex flex-col gap-4">
      <div className="grid md:grid-cols-2 gap-4">
        <Layer
          title="Conservative · curtailed renewables"
          subtitle="Clean energy the grid literally threw away in the window"
          t={result.conservative}
          annual={annualLoading ? undefined : annual?.conservative}
          presenter={presenter}
          missing={hasCurtailment ? "—" : "Not reported: this ISO doesn't publish renewable curtailment."}
        />
        <Layer
          title="Optimistic · idle peak capacity"
          subtitle="Σ (evening net-load peak − net load) over the window"
          t={result.optimistic}
          annual={annualLoading ? undefined : annual?.optimistic}
          presenter={presenter}
        />
      </div>
      {p && (
        <div className="card p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Avg price in window" value={fmtPrice(p.windowAvg)} cls={presenter ? "text-3xl" : "text-2xl"} />
          <Stat label="Avg price 17:00–21:00" value={fmtPrice(p.eveningAvg)} cls={presenter ? "text-3xl" : "text-2xl"} />
          <Stat label="Saved by shifting" value={p.spreadPerMwh == null ? "—" : `${fmtPrice(p.spreadPerMwh)}`} cls={presenter ? "text-3xl" : "text-2xl"} />
          <Stat label="Hours at ≤ $0 in window" value={`${p.nonPositiveHours} of ${p.windowHours}`} cls={presenter ? "text-3xl" : "text-2xl"} />
        </div>
      )}
      {!presenter && <p className="muted text-sm">{annualNote}</p>}
    </div>
  );
}
