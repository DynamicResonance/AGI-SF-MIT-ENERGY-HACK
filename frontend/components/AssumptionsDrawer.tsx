"use client";
import { ASSUMPTION_SOURCES, Assumptions, DEFAULT_ASSUMPTIONS, SLIDER_RANGES } from "@/lib/assumptions";

interface Props {
  open: boolean;
  onClose: () => void;
  value: Assumptions;
  onChange: (a: Assumptions) => void;
}

const fmt = (k: keyof Assumptions, v: number) =>
  k === "usdPerMTokens" ? `$${v.toFixed(2)}` : k === "utilization" ? `${Math.round(v * 100)}%` : k === "dipThresholdPct" ? `${v}%` : k === "tokensPerSecPerGpu" ? v.toLocaleString("en-US") : String(v);

export default function AssumptionsDrawer({ open, onClose, value, onChange }: Props) {
  if (!open) return null;
  const keys = Object.keys(SLIDER_RANGES) as (keyof Assumptions)[];
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-label="Assumptions">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <aside className="relative w-full max-w-md h-full overflow-y-auto p-6 flex flex-col gap-5" style={{ background: "var(--surface-1)", borderLeft: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Assumptions</h2>
          <div className="flex gap-2">
            <button className="btn text-sm" onClick={() => onChange(DEFAULT_ASSUMPTIONS)}>Reset</button>
            <button className="btn text-sm" onClick={onClose}>Close</button>
          </div>
        </div>
        <p className="muted text-sm">
          These are assumptions, not data. Defaults: a 70B-class model batch-served on H100. Everything recalculates instantly.
        </p>
        {keys.map((k) => {
          const r = SLIDER_RANGES[k];
          const changed = value[k] !== DEFAULT_ASSUMPTIONS[k];
          return (
            <label key={k} className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium">
                  {r.label} <span className="badge-assumption">assumption</span>
                </span>
                <span className="tabular font-semibold">
                  {fmt(k, value[k])}
                  {changed && <span className="muted font-normal text-xs"> (default {fmt(k, DEFAULT_ASSUMPTIONS[k])})</span>}
                </span>
              </span>
              <input type="range" min={r.min} max={r.max} step={r.step} value={value[k]}
                onChange={(e) => onChange({ ...value, [k]: Number(e.target.value) })} />
              <span className="muted text-xs">{ASSUMPTION_SOURCES[k]}</span>
            </label>
          );
        })}
      </aside>
    </div>
  );
}
