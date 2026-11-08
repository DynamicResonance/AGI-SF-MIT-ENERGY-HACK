"use client";
import { useEffect, useRef, useState } from "react";
import {
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
import {
  AgentEvent,
  AgentJob,
  Grid,
  SimEntry,
  agentStatus,
  loadRecorded,
  recordedToEvents,
  runLive,
  type RecordedRun,
} from "@/lib/agent";
import { hh } from "@/lib/format";

const TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];
const usd = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const axisTick = { fill: "var(--text-muted)", fontSize: 13 };

interface State {
  window: [number, number] | null;
  maxMw: number;
  jobs: AgentJob[];
  grid: Grid | null;
  baseline: SimEntry | null;
  iterations: (SimEntry & { improved?: boolean })[];
  thinking: number | null;
  done: { elapsed_s: number } | null;
  error: string | null;
  source: "live" | "replay" | null;
  dataMode?: string;
}

const EMPTY: State = { window: null, maxMw: 0, jobs: [], grid: null, baseline: null, iterations: [], thinking: null, done: null, error: null, source: null };

function reduce(s: State, e: AgentEvent): State {
  switch (e.type) {
    case "start":
      return { ...s, window: e.window, maxMw: e.max_mw, jobs: e.synthetic_jobs, grid: e.grid, baseline: e.baseline, iterations: [], done: null, error: null, dataMode: e.data_mode };
    case "thinking":
      return { ...s, thinking: e.iteration };
    case "iteration": {
      const { type: _t, best_score: _b, ...entry } = e;
      void _t;
      void _b;
      return { ...s, thinking: null, iterations: [...s.iterations, entry] };
    }
    case "done":
      return { ...s, thinking: null, done: { elapsed_s: e.elapsed_s } };
    case "error":
      return { ...s, thinking: null, error: e.message };
  }
}

export default function AgentLoop({ region, date, presenter }: { region: string; date: string; presenter: boolean }) {
  const [st, setSt] = useState<State>(EMPTY);
  const [iters, setIters] = useState(8);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof agentStatus>>>(null);
  const [recorded, setRecorded] = useState<RecordedRun | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    agentStatus().then(setStatus);
  }, []);
  useEffect(() => {
    setSt(EMPTY);
    setRecorded(null);
    loadRecorded(region, date).then(setRecorded);
  }, [region, date]);

  const apply = (e: AgentEvent) => setSt((s) => reduce(s, e));

  async function startLive() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSt({ ...EMPTY, source: "live" });
    setRunning(true);
    try {
      await runLive(region, date, iters, apply, ac.signal);
      loadRecorded(region, date).then(setRecorded);
    } catch (e) {
      if (!ac.signal.aborted) apply({ type: "error", message: `live run failed: ${(e as Error).message}` });
    } finally {
      setRunning(false);
    }
  }

  async function replay() {
    if (!recorded) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSt({ ...EMPTY, source: "replay" });
    setRunning(true);
    for (const ev of recordedToEvents(recorded)) {
      if (ac.signal.aborted) break;
      apply(ev);
      await new Promise((r) => setTimeout(r, ev.type === "thinking" ? 700 : ev.type === "iteration" ? 500 : 200));
    }
    setRunning(false);
  }

  const best = [st.baseline, ...st.iterations].filter(Boolean).reduce<SimEntry | null>((b, x) => (!b || x!.score < b.score ? x! : b), null);
  const scoreData = st.baseline
    ? [{ i: 0, score: st.baseline.score, best: st.baseline.score }, ...st.iterations.map((it, k) => ({
        i: it.iteration ?? k + 1,
        score: it.score,
        best: Math.min(st.baseline!.score, ...st.iterations.slice(0, k + 1).map((x) => x.score)),
      }))]
    : [];
  const hourly = st.grid
    ? Array.from({ length: 24 }, (_, h) => ({
        x: h + 0.5,
        hour: h,
        net: st.grid!.net[h],
        lmp: st.grid!.lmp?.[h] ?? null,
        base: st.baseline?.hourly_mw[h] ?? 0,
        plan: best && best !== st.baseline ? best.hourly_mw[h] : null,
      }))
    : [];
  // Improvement in $ (not %): credits can push the score below zero, which makes a percentage meaningless.
  const gain = (v: number) => (st.baseline ? st.baseline.score - v : 0);
  const delta = (v: number) => `${gain(v) >= 0 ? "−" : "+"}${usd(Math.abs(gain(v)))}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4 flex flex-wrap items-center gap-3" style={{ borderColor: "#fab219" }}>
        <span className="font-semibold">⚠ Synthetic workload</span>
        <span className="secondary text-sm">
          50 generated deferred agent jobs (overnight research, inbox digests, code review, deep reasoning; fixed seed).
          The grid data ({region}, {date}) is real.
        </span>
      </div>

      {!presenter && (
        <div className="card p-4 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="secondary text-sm">Iterations</span>
            <select value={iters} onChange={(e) => setIters(Number(e.target.value))} disabled={running}>
              {[4, 8, 12].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button className="btn" onClick={startLive} disabled={running || !status?.proposer_configured}
            title={status?.proposer_configured ? "" : "Set ANTHROPIC_API_KEY on the backend to run live"}>
            ▶ Run live
          </button>
          <button className="btn" onClick={replay} disabled={running || !recorded}>⟲ Replay recorded run</button>
          {running && <button className="btn" onClick={() => { abortRef.current?.abort(); setRunning(false); }}>Stop</button>}
          <span className="muted text-sm ml-auto">
            {status === null ? "backend offline: replay only" : status.proposer_configured ? `Proposer: ${status.model} (effort ${status.effort})` : "Live run unavailable: ANTHROPIC_API_KEY not set"}
            {recorded ? ` · recorded run from ${new Date(recorded.started_at).toLocaleString()}` : " · no recorded run for this region/date"}
          </span>
        </div>
      )}

      {st.error && <div className="card p-4" style={{ borderColor: "#d03b3b" }}>⚠ {st.error}</div>}

      {st.baseline && (
        <div className="grid lg:grid-cols-5 gap-4">
          <section className="card p-4 lg:col-span-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold">Score per iteration (penalized cost, lower is better)</h3>
              {best && best !== st.baseline && (
                <span className="flex flex-col items-end">
                  <span className={`${presenter ? "text-3xl" : "text-2xl"} font-bold tabular`}>{usd(gain(best.score))}/day lower cost than status quo</span>
                  <span className="secondary text-sm tabular">
                    in dip window {Math.round(st.baseline.breakdown.window_share * 100)}% → {Math.round(best.breakdown.window_share * 100)}% ·
                    avg price ${st.baseline.breakdown.avg_price_usd_per_mwh?.toFixed(2)} → ${best.breakdown.avg_price_usd_per_mwh?.toFixed(2)}/MWh ·
                    curtailed absorbed {Math.round(st.baseline.breakdown.curtailed_mwh_absorbed)} → {Math.round(best.breakdown.curtailed_mwh_absorbed)} MWh
                  </span>
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-5 text-sm secondary">
              <span className="flex items-center gap-1.5"><svg width="18" height="10"><line x1="1" x2="17" y1="5" y2="5" stroke="var(--series-net)" strokeWidth="3" /></svg>Proposed plan</span>
              <span className="flex items-center gap-1.5"><svg width="18" height="10"><line x1="1" x2="17" y1="5" y2="5" stroke="var(--series-curt)" strokeWidth="2" /></svg>Best so far</span>
              <span className="flex items-center gap-1.5"><svg width="18" height="10"><line x1="1" x2="17" y1="5" y2="5" stroke="var(--series-load)" strokeWidth="2" strokeDasharray="4 3" /></svg>Baseline: run every job immediately</span>
            </div>
            <div style={{ height: presenter ? 360 : 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={scoreData} margin={{ top: 10, right: 16, bottom: 0, left: 10 }}>
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  <XAxis dataKey="i" type="number" domain={[0, Math.max(st.iterations.length, iters)]} allowDecimals={false} tick={axisTick} stroke="var(--border)"
                    label={{ value: "iteration", position: "insideBottomRight", offset: -2, fill: "var(--text-muted)", fontSize: 12 }} />
                  <YAxis tick={axisTick} stroke="var(--border)" width={70} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} domain={["auto", "auto"]} />
                  <ReferenceLine y={st.baseline.score} stroke="var(--series-load)" strokeDasharray="5 4" />
                  <Line dataKey="best" type="stepAfter" stroke="var(--series-curt)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="score" stroke="var(--series-net)" strokeWidth={3} dot={{ r: 5, stroke: "var(--surface-1)", strokeWidth: 2, fill: "var(--series-net)" }} isAnimationActive={false} />
                  <Tooltip formatter={(v: number, n: string) => [usd(v), n === "best" ? "best so far" : "score"]} labelFormatter={(l) => (l === 0 ? "baseline" : `iteration ${l}`)}
                    contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--border)" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card p-4 lg:col-span-2 flex flex-col gap-2" style={{ maxHeight: presenter ? 480 : 400 }}>
            <h3 className="text-lg font-semibold">
              Iteration log {st.source === "replay" && <span className="badge-assumption">replay of recorded run</span>}
              {st.source === "live" && <span className="badge-assumption">live</span>}
            </h3>
            <ol className="overflow-y-auto flex flex-col gap-2 text-sm pr-1">
              <li className="secondary">
                <b>Baseline</b> (status quo): {usd(st.baseline.score)} · {Math.round(st.baseline.breakdown.window_share * 100)}% of MWh in window
              </li>
              {st.iterations.map((it) => (
                <li key={it.iteration} className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
                  <div className="flex justify-between gap-2 tabular">
                    <b>Iteration {it.iteration}</b>
                    <span>
                      {usd(it.score)} ({delta(it.score)} vs baseline) {it.improved ? "▲ new best" : ""}
                    </span>
                  </div>
                  <div className="secondary">{it.rationale}</div>
                  <div className="muted">
                    window {Math.round(it.breakdown.window_share * 100)}% · peak {Math.round(it.breakdown.evening_peak_mwh)} MWh · missed {it.breakdown.deadlines_missed} · over cap {it.breakdown.cap_overflow_mwh.toFixed(0)} MWh
                    {it.violations.length > 0 && ` · ${it.violations.length} violation(s)`}
                  </div>
                </li>
              ))}
              {st.thinking != null && <li className="muted animate-pulse">Iteration {st.thinking}: Claude is proposing a schedule…</li>}
              {st.done && (
                <li className="font-semibold">
                  Done: best plan {usd(gain(best!.score))}/day lower than baseline ({st.done.elapsed_s}s)
                </li>
              )}
            </ol>
          </section>
        </div>
      )}

      {st.grid && st.window && (
        <section className="card p-4 flex flex-col gap-2">
          <h3 className="text-lg font-semibold">Schedule on the duck curve</h3>
          <div className="text-sm secondary flex items-center gap-2">
            <span style={{ background: "var(--series-net)", width: 16, height: 3, borderRadius: 2 }} /> Net load (GW) · shaded: midday surplus window {hh(st.window[0])}–{hh(st.window[1])}
          </div>
          <div style={{ height: presenter ? 280 : 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={hourly} margin={{ top: 8, right: 16, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="x" type="number" domain={[0, 24]} ticks={TICKS} tickFormatter={hh} tick={axisTick} stroke="var(--border)" />
                <YAxis tick={axisTick} stroke="var(--border)" width={44} tickFormatter={(v) => `${(v / 1000).toFixed(0)}`} />
                <ReferenceArea x1={st.window[0]} x2={st.window[1]} fill="var(--window-fill)" />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Line dataKey="net" type="monotone" stroke="var(--series-net)" strokeWidth={3} dot={false} isAnimationActive={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-x-5 text-sm secondary">
            <span className="font-medium">Agent site load, MW ·</span>
            <span className="flex items-center gap-1.5"><span style={{ background: "var(--series-load)", width: 10, height: 10, borderRadius: 2 }} />Status quo (run immediately)</span>
            <span className="flex items-center gap-1.5"><span style={{ background: "var(--series-curt)", width: 10, height: 10, borderRadius: 2 }} />Best agent plan</span>
            <span className="flex items-center gap-1.5"><svg width="18" height="10"><line x1="1" x2="17" y1="5" y2="5" stroke="#d03b3b" strokeWidth="2" strokeDasharray="4 3" /></svg>Site cap {st.maxMw} MW</span>
          </div>
          <div style={{ height: presenter ? 260 : 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={hourly} margin={{ top: 8, right: 16, bottom: 0, left: 4 }} barGap={2} barCategoryGap={4}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="x" type="number" domain={[0, 24]} ticks={TICKS} tickFormatter={hh} tick={axisTick} stroke="var(--border)" />
                <YAxis tick={axisTick} stroke="var(--border)" width={44} />
                <ReferenceArea x1={st.window[0]} x2={st.window[1]} fill="var(--window-fill)" />
                <ReferenceLine y={st.maxMw} stroke="#d03b3b" strokeDasharray="4 3" />
                <Bar dataKey="base" fill="var(--series-load)" radius={[3, 3, 0, 0]} isAnimationActive={false} barSize={10} />
                <Bar dataKey="plan" fill="var(--series-curt)" radius={[3, 3, 0, 0]} isAnimationActive={false} barSize={10} />
                <Tooltip formatter={(v: number, n: string) => [`${Math.round(v)} MW`, n === "base" ? "status quo" : "agent plan"]} labelFormatter={(l) => hh(Math.floor(Number(l)))}
                  contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--border)" }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {st.baseline && best && (
        <section className="card p-4 overflow-x-auto">
          <h3 className="text-lg font-semibold mb-2">Score breakdown: status quo vs best plan</h3>
          <table className="w-full text-sm tabular">
            <thead className="secondary">
              <tr><th className="text-left font-medium">Component</th><th className="text-right font-medium">Status quo</th><th className="text-right font-medium">Best plan</th></tr>
            </thead>
            <tbody>
              {([
                ["Energy cost at hub price", (b: SimEntry) => usd(b.breakdown.energy_cost_usd)],
                ["Evening-peak penalty", (b: SimEntry) => `${usd(b.breakdown.peak_penalty_usd)} (${Math.round(b.breakdown.evening_peak_mwh)} MWh)`],
                ["Missed deadlines", (b: SimEntry) => `${usd(b.breakdown.deadline_penalty_usd)} (${b.breakdown.deadlines_missed})`],
                ["Over site cap", (b: SimEntry) => `${usd(b.breakdown.cap_penalty_usd)} (${b.breakdown.cap_overflow_mwh.toFixed(1)} MWh)`],
                ["Credit: MWh in surplus window", (b: SimEntry) => `${usd(b.breakdown.window_credit_usd)} (${Math.round(b.breakdown.window_mwh)} MWh, ${Math.round(b.breakdown.window_share * 100)}%)`],
                ["Credit: curtailed MWh absorbed", (b: SimEntry) => `${usd(b.breakdown.curtailment_credit_usd)} (${Math.round(b.breakdown.curtailed_mwh_absorbed)} MWh)`],
                ["Average price paid", (b: SimEntry) => (b.breakdown.avg_price_usd_per_mwh == null ? "—" : `$${b.breakdown.avg_price_usd_per_mwh.toFixed(2)}/MWh`)],
                ["Score (lower is better)", (b: SimEntry) => usd(b.score)],
              ] as [string, (b: SimEntry) => string][]).map(([k, f]) => (
                <tr key={k} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="py-1">{k}</td>
                  <td className="text-right">{f(st.baseline!)}</td>
                  <td className="text-right font-semibold">{f(best)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!presenter && (
            <p className="muted text-sm mt-2">
              Same {st.jobs.length} jobs, same total energy ({Math.round(st.baseline.breakdown.total_mwh).toLocaleString()} MWh); only start times change.
              The simulator/scorer is deterministic Python (no LLM) and replays every plan on the real hourly data.
            </p>
          )}
        </section>
      )}

      {!st.baseline && !st.error && (
        <div className="card p-10 text-center secondary">
          {recorded ? "Press “Replay recorded run” (or “Run live”) to start the agent loop." : status?.proposer_configured ? "Press “Run live” to start the agent loop." : "No recorded run for this region/date, and live runs need ANTHROPIC_API_KEY on the backend."}
        </div>
      )}
    </div>
  );
}
