"use client";
/**
 * 24h duck chart. Values are hourly averages, plotted at mid-hour (h + 0.5) on a
 * 0-24 axis so the shaded window [start, end) lines up with clock hours.
 * LMP lives in its own aligned panel below (no dual y-axis: two scales on one
 * plot invite false visual correlations).
 */
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DaySeries, Window } from "@/lib/calc";
import { hh } from "@/lib/format";

const TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];
const gw = (v: number) => `${(v / 1000).toFixed(0)}`;

interface Props {
  day: DaySeries;
  window: Window;
  eveningPeakHour: number | null;
  height: number;
  lmpLabel: string | null;
  showTable: boolean;
}

type Row = { x: number; hour: number; load: number | null; solar: number | null; net: number | null; curt: number | null; lmp: number | null };

function rows(day: DaySeries): Row[] {
  return Array.from({ length: 24 }, (_, h) => ({
    x: h + 0.5,
    hour: h,
    load: day.load[h],
    solar: day.solar[h],
    net: day.net[h],
    curt: day.curtailment ? day.curtailment[h] : null,
    lmp: day.lmp ? day.lmp[h] : null,
  }));
}

function TipBox({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  const f = (v: number | null, u = "MW") => (v == null ? "—" : `${Math.round(v).toLocaleString("en-US")} ${u}`);
  const items: [string, string, string][] = [
    ["Gross load", f(r.load), "var(--series-load)"],
    ["Solar", f(r.solar), "var(--series-solar)"],
    ["Net load", f(r.net), "var(--series-net)"],
  ];
  if (r.curt != null) items.push(["Curtailed", f(r.curt, "MWh"), "var(--series-curt)"]);
  if (r.lmp != null) items.push(["Price", `$${r.lmp.toFixed(2)}/MWh`, "var(--series-lmp)"]);
  return (
    <div className="card px-3 py-2 text-sm shadow-lg tabular">
      <div className="font-semibold mb-1">
        {hh(r.hour)}–{hh(r.hour + 1)}
      </div>
      {items.map(([k, v, c]) => (
        <div key={k} className="flex items-center gap-2 justify-between">
          <span className="flex items-center gap-1.5 secondary">
            <span style={{ background: c, width: 10, height: 3, borderRadius: 2, display: "inline-block" }} />
            {k}
          </span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ hasCurt }: { hasCurt: boolean }) {
  const item = (label: string, color: string, kind: "line" | "bar" | "area" | "dash") => (
    <span key={label} className="flex items-center gap-1.5">
      <svg width="18" height="10" aria-hidden>
        {kind === "bar" ? (
          <rect x="5" y="1" width="8" height="9" rx="2" fill={color} />
        ) : kind === "area" ? (
          <rect x="1" y="2" width="16" height="7" rx="2" fill={color} opacity={0.35} stroke={color} />
        ) : (
          <line x1="1" x2="17" y1="5" y2="5" stroke={color} strokeWidth={kind === "line" ? 3 : 2} strokeDasharray={kind === "dash" ? "4 3" : undefined} />
        )}
      </svg>
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm secondary">
      <span className="font-medium">GW, hourly avg ·</span>
      {item("Gross load", "var(--series-load)", "dash")}
      {item("Solar", "var(--series-solar)", "area")}
      {item("Net load (load − solar − wind)", "var(--series-net)", "line")}
      {hasCurt && item("Curtailed renewables (MWh/h)", "var(--series-curt)", "bar")}
      <span className="flex items-center gap-1.5">
        <span style={{ background: "var(--window-fill)", border: "1px solid var(--accent)", width: 16, height: 10, borderRadius: 2 }} />
        Dip window
      </span>
    </div>
  );
}

export default function DuckChart({ day, window: w, eveningPeakHour, height, lmpLabel, showTable }: Props) {
  const data = rows(day);
  const hasCurt = !!day.curtailment;
  const hasLmp = !!day.lmp && day.lmp.some((v) => v != null);
  const axisTick = { fill: "var(--text-muted)", fontSize: 13 };

  return (
    <div className="flex flex-col gap-2">
      <Legend hasCurt={hasCurt} />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 18, right: 16, bottom: 0, left: 4 }} barCategoryGap={2}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis dataKey="x" type="number" domain={[0, 24]} ticks={TICKS} tickFormatter={hh} tick={axisTick} stroke="var(--border)" />
            <YAxis tickFormatter={gw} tick={axisTick} stroke="var(--border)" width={44} />
            <ReferenceArea x1={w.start} x2={w.end} fill="var(--window-fill)" stroke="var(--accent)" strokeOpacity={0.5} ifOverflow="visible"
              label={{ value: `Dip window ${hh(w.start)}–${hh(w.end)}`, position: "insideTop", fill: "var(--text-secondary)", fontSize: 13 }} />
            <ReferenceLine y={0} stroke="var(--border)" />
            {eveningPeakHour != null && (
              <ReferenceLine x={eveningPeakHour + 0.5} stroke="var(--text-muted)" strokeDasharray="2 4"
                label={{ value: "evening peak", position: "insideTopRight", fill: "var(--text-muted)", fontSize: 12 }} />
            )}
            {hasCurt && <Bar dataKey="curt" fill="var(--series-curt)" radius={[4, 4, 0, 0]} isAnimationActive={false} />}
            <Area dataKey="solar" type="monotone" stroke="var(--series-solar)" fill="var(--series-solar)" fillOpacity={0.25} strokeWidth={2} isAnimationActive={false} connectNulls />
            <Line dataKey="load" type="monotone" stroke="var(--series-load)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="net" type="monotone" stroke="var(--series-net)" strokeWidth={4} dot={false} isAnimationActive={false} connectNulls
              activeDot={{ r: 6, stroke: "var(--surface-1)", strokeWidth: 2 }} />
            <Tooltip content={<TipBox />} cursor={{ stroke: "var(--text-muted)", strokeDasharray: "3 3" }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {hasLmp && (
        <>
          <div className="text-sm secondary flex items-center gap-2 pl-12">
            <span style={{ background: "var(--series-lmp)", width: 16, height: 3, borderRadius: 2 }} />
            {lmpLabel ?? "Price"} ($/MWh)
          </div>
          <div style={{ height: Math.max(110, height * 0.3) }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 6, right: 16, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="x" type="number" domain={[0, 24]} ticks={TICKS} tickFormatter={hh} tick={axisTick} stroke="var(--border)" />
                <YAxis tick={axisTick} stroke="var(--border)" width={44} tickFormatter={(v) => `$${v}`} />
                <ReferenceArea x1={w.start} x2={w.end} fill="var(--window-fill)" ifOverflow="visible" />
                <ReferenceLine y={0} stroke="var(--text-muted)" />
                <Line dataKey="lmp" type="stepAfter" stroke="var(--series-lmp)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                <Tooltip content={<TipBox />} cursor={{ stroke: "var(--text-muted)", strokeDasharray: "3 3" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {showTable && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular">
            <thead className="secondary">
              <tr>
                {["Hour", "Gross load MW", "Solar MW", "Wind MW", "Net load MW", "Curtailed MWh", "Price $/MWh"].map((h) => (
                  <th key={h} className="text-right font-medium px-2 py-1 first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r) => {
                const inW = r.hour >= w.start && r.hour < w.end;
                const c = (v: number | null, d = 0) => (v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: d }));
                return (
                  <tr key={r.hour} style={inW ? { background: "var(--window-fill)" } : undefined}>
                    <td className="px-2 py-0.5">{hh(r.hour)}</td>
                    <td className="text-right px-2">{c(r.load)}</td>
                    <td className="text-right px-2">{c(r.solar)}</td>
                    <td className="text-right px-2">{c(day.wind[r.hour])}</td>
                    <td className="text-right px-2">{c(r.net)}</td>
                    <td className="text-right px-2">{hasCurt ? c(r.curt) : "n/a"}</td>
                    <td className="text-right px-2">{c(r.lmp, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
