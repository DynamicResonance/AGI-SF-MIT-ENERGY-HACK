"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DuckChart from "@/components/DuckChart";
import BigNumbers from "@/components/BigNumbers";
import AssumptionsDrawer from "@/components/AssumptionsDrawer";
import HowWeCalculate from "@/components/HowWeCalculate";
import AgentLoop from "@/components/AgentLoop";
import { ANNUALIZE_DAY_OPTIONS, Assumptions, DEFAULT_ANNUALIZE_DAYS, DEFAULT_ASSUMPTIONS } from "@/lib/assumptions";
import { annualize, computeDay, type Window } from "@/lib/calc";
import { fetchDays, fetchRegions } from "@/lib/api";
import type { DaysResponse, Meta, RegionInfo } from "@/lib/types";
import { hh } from "@/lib/format";

const todayIn = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

const MODE_LABEL: Record<Meta["mode"], { text: string; color: string }> = {
  live: { text: "LIVE · GridStatus API", color: "#0ca30c" },
  cache: { text: "CACHED · GridStatus API", color: "#0ca30c" },
  snapshot: { text: "OFFLINE · bundled snapshot", color: "#fab219" },
  "browser-snapshot": { text: "OFFLINE · bundled snapshot (backend unreachable)", color: "#fab219" },
};

export default function Page() {
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [regionId, setRegionId] = useState("CAISO");
  const [date, setDate] = useState<string>("");
  const [day, setDay] = useState<DaysResponse | null>(null);
  const [hist, setHist] = useState<DaysResponse | null>(null);
  const [histLoading, setHistLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [a, setA] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const [override, setOverride] = useState<Window | null>(null);
  const [annualDays, setAnnualDays] = useState<number>(DEFAULT_ANNUALIZE_DAYS);
  const [presenter, setPresenter] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [offline, setOffline] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [tab, setTab] = useState<"calc" | "agent">("calc");
  const reqId = useRef(0);

  const region = regions.find((r) => r.id === regionId);

  useEffect(() => {
    fetchRegions()
      .then((rs) => {
        setRegions(rs);
        const r = rs.find((x) => x.id === "CAISO") ?? rs[0];
        setRegionId(r.id);
        setDate(r.default_date);
      })
      .catch((e) => setError(`Could not load regions: ${e.message}`));
  }, []);

  // Day data (fast) and trailing history for annualization (can be slower) load independently.
  useEffect(() => {
    if (!region || !date) return;
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    fetchDays(region.id, date, 1, offline)
      .then((r) => id === reqId.current && setDay(r))
      .catch((e) => id === reqId.current && (setDay(null), setError(e.message)))
      .finally(() => id === reqId.current && setLoading(false));
  }, [region, date, offline]);

  useEffect(() => {
    if (!region || !date) return;
    let alive = true;
    setHistLoading(true);
    fetchDays(region.id, date, annualDays, offline)
      .then((r) => alive && setHist(r))
      .catch(() => alive && setHist(null))
      .finally(() => alive && setHistLoading(false));
    return () => {
      alive = false;
    };
  }, [region, date, annualDays, offline]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "SELECT") return;
      if (e.key === "p" || e.key === "P") setPresenter((p) => !p);
      if (e.key === "Escape") {
        setPresenter(false);
        setDrawer(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const d0 = day?.days[0];
  const result = useMemo(() => (d0 ? computeDay(d0, a, override) : null), [d0, a, override]);
  const annual = useMemo(() => (hist && !histLoading ? annualize(hist.days, a, override) : null), [hist, histLoading, a, override]);
  const hoursPresent = d0 ? d0.net.filter((v) => v != null).length : 24;

  const changeRegion = useCallback(
    (id: string) => {
      const r = regions.find((x) => x.id === id);
      if (!r) return;
      setRegionId(id);
      setDate(r.default_date);
      setOverride(null);
    },
    [regions],
  );

  const w = result?.window;
  const mode = day?.meta.mode;

  return (
    <main className={`mx-auto flex flex-col gap-5 px-4 py-5 ${presenter ? "max-w-[1800px]" : "max-w-7xl"}`}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className={`${presenter ? "text-4xl" : "text-3xl"} font-bold`}>Midday Surplus → Tokens</h1>
          <p className="secondary">
            {region?.label ?? "…"} · {date}
            {result && ` · dip window ${hh(result.window.start)}–${hh(result.window.end)}`}
            {result && !override && !result.dip.detected && " (no dip below threshold, fallback window)"}
            {override && " (manual window)"}
          </p>
        </div>
        <div className="flex gap-2">
          {!presenter && <button className="btn" onClick={() => setDrawer(true)}>Assumptions</button>}
          <button className="btn" aria-pressed={presenter} onClick={() => setPresenter((p) => !p)} title="Shortcut: P">
            {presenter ? "Exit presenter" : "Presenter mode"}
          </button>
        </div>
      </header>

      <nav className="flex gap-2" role="tablist">
        {([["calc", "Calculator"], ["agent", "Agent loop"]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`btn ${tab === id ? "font-semibold" : ""}`}
            style={tab === id ? { borderColor: "var(--accent)", boxShadow: "inset 0 0 0 1px var(--accent)" } : undefined} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {!presenter && (
        <section className="card p-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              <span className="secondary text-sm">Region</span>
              <select value={regionId} onChange={(e) => changeRegion(e.target.value)}>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="secondary text-sm">Date</span>
              <input type="date" value={date} max={region ? todayIn(region.tz) : undefined} min="2019-01-01"
                onChange={(e) => e.target.value && setDate(e.target.value)} />
            </label>
            <button className="btn text-sm" aria-pressed={!!region && date === region.default_date} onClick={() => region && setDate(region.default_date)}
              title={region?.default_date_reason}>High-solar spring day</button>
            <button className="btn text-sm" aria-pressed={!!region && date === todayIn(region.tz)} onClick={() => region && setDate(todayIn(region.tz))}>
              Today / latest
            </button>
            {tab === "calc" && <label className="flex items-center gap-2 ml-auto">
              <span className="secondary text-sm">Annualize over last</span>
              <select value={annualDays} onChange={(e) => setAnnualDays(Number(e.target.value))}>
                {ANNUALIZE_DAY_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n} days</option>
                ))}
              </select>
            </label>}
          </div>

          {tab === "calc" && result && w && (
            <div className="flex flex-wrap items-center gap-4">
              <span className="secondary text-sm w-28">Dip window</span>
              <button className="btn text-sm" aria-pressed={!override} onClick={() => setOverride(null)}>
                Auto{result.dip.detected ? ` (${hh(result.dip.window.start)}–${hh(result.dip.window.end)})` : " (fallback)"}
              </button>
              <label className="flex items-center gap-2 flex-1 min-w-[180px]">
                <span className="text-sm tabular w-24">start {hh(w.start)}</span>
                <input type="range" min={0} max={23} step={1} value={w.start}
                  onChange={(e) => { const s = Number(e.target.value); setOverride({ start: s, end: Math.max(s + 1, w.end) }); }} />
              </label>
              <label className="flex items-center gap-2 flex-1 min-w-[180px]">
                <span className="text-sm tabular w-24">end {hh(w.end)}</span>
                <input type="range" min={1} max={24} step={1} value={w.end}
                  onChange={(e) => { const en = Number(e.target.value); setOverride({ start: Math.min(w.start, en - 1), end: en }); }} />
              </label>
            </div>
          )}
          {region?.notes.map((n) => (
            <p key={n} className="muted text-sm">ⓘ {n}</p>
          ))}
        </section>
      )}

      {error && (
        <div className="card p-4" style={{ borderColor: "#d03b3b" }}>
          <b>⚠ No data:</b> {error}
        </div>
      )}
      {tab === "agent" && region && date && <AgentLoop region={region.id} date={date} presenter={presenter} />}

      {tab === "calc" && <>
      {d0 && hoursPresent < 24 && (
        <div className="card p-3 text-sm" style={{ borderColor: "#fab219" }}>
          ⚠ Partial day: {hoursPresent} of 24 hours available so far. Numbers cover only the hours reported.
        </div>
      )}

      {d0 && result && (
        <>
          <section className={`card p-4 ${loading ? "opacity-60" : ""}`}>
            <DuckChart day={d0} window={result.window} eveningPeakHour={result.dip.eveningPeakHour}
              height={presenter ? 520 : 380} lmpLabel={region?.lmp_label ?? null} showTable={showTable && !presenter} />
          </section>
          <BigNumbers result={result} annual={annual} annualDays={annualDays} annualLoading={histLoading}
            hasCurtailment={!!region?.has_curtailment} presenter={presenter} />
        </>
      )}
      {!d0 && !error && <div className="card p-10 text-center secondary">Loading grid data…</div>}

      {day && (
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm secondary">
          {mode && (
            <span className="flex items-center gap-1.5 font-medium">
              <span style={{ width: 9, height: 9, borderRadius: 9, background: MODE_LABEL[mode].color, display: "inline-block" }} />
              {MODE_LABEL[mode].text}
            </span>
          )}
          <span>Source: {day.meta.provider}</span>
          <span>Data fetched: {day.meta.fetched_at ? new Date(day.meta.fetched_at).toLocaleString() : "—"}</span>
          {!presenter && (
            <span className="muted">
              Datasets: {Object.entries(day.meta.sources).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(" · ")}
            </span>
          )}
          {!presenter && (
            <span className="flex gap-2 ml-auto">
              <button className="btn text-xs" aria-pressed={showTable} onClick={() => setShowTable((s) => !s)}>Data table</button>
              <button className="btn text-xs" aria-pressed={offline} onClick={() => setOffline((o) => !o)}
                title="Use bundled snapshot only (for flaky venue Wi-Fi)">Force offline</button>
            </span>
          )}
        </footer>
      )}

      {!presenter && <HowWeCalculate />}
      </>}
      <AssumptionsDrawer open={drawer} onClose={() => setDrawer(false)} value={a} onChange={setA} />
    </main>
  );
}
