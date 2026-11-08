/** Agent-loop client: live NDJSON stream, or replay of a recorded run (backend or bundled file). */

export interface Breakdown {
  energy_cost_usd: number;
  peak_penalty_usd: number;
  deadline_penalty_usd: number;
  cap_penalty_usd: number;
  window_credit_usd: number;
  curtailment_credit_usd: number;
  total_mwh: number;
  window_mwh: number;
  window_share: number;
  evening_peak_mwh: number;
  curtailed_mwh_absorbed: number;
  deadlines_missed: number;
  cap_overflow_mwh: number;
  avg_price_usd_per_mwh: number | null;
  window: [number, number];
  max_mw: number;
}

export interface SimEntry {
  label: string;
  iteration?: number;
  rationale?: string;
  score: number;
  breakdown: Breakdown;
  hourly_mw: number[];
  violations: string[];
  starts: Record<string, number>;
  usage?: { model: string; input_tokens: number; output_tokens: number };
}

export interface AgentJob {
  id: string;
  kind: string;
  description: string;
  tokens: number;
  kwh: number;
  mw: number;
  duration_h: number;
  earliest_start: number;
  deadline: number;
}

export interface Grid {
  net: (number | null)[];
  load: (number | null)[];
  solar: (number | null)[];
  lmp: (number | null)[] | null;
  curtailment: (number | null)[] | null;
}

export type AgentEvent =
  | { type: "start"; region: string; date: string; window: [number, number]; max_mw: number; synthetic_jobs: AgentJob[]; grid: Grid; baseline: SimEntry; iterations_planned: number; data_mode: string }
  | { type: "thinking"; iteration: number }
  | ({ type: "iteration"; improved: boolean; best_score: number } & SimEntry)
  | { type: "done"; best: SimEntry; improvement_pct: number | null; elapsed_s: number; saved: boolean }
  | { type: "error"; message: string };

export interface RecordedRun {
  region: string;
  date: string;
  window: [number, number];
  max_mw: number;
  synthetic_jobs: AgentJob[];
  grid: Grid;
  baseline: SimEntry;
  iterations: SimEntry[];
  best: SimEntry;
  improvement_pct: number | null;
  elapsed_s: number;
  started_at: string;
  data_mode: string;
}

export async function agentStatus(): Promise<{ proposer_configured: boolean; model: string; effort: string } | null> {
  try {
    const r = await fetch("/api/agent/status", { signal: AbortSignal.timeout(5000) });
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

export async function runLive(region: string, date: string, iterations: number, onEvent: (e: AgentEvent) => void, signal: AbortSignal) {
  const r = await fetch(`/api/agent/run?${new URLSearchParams({ region, date, iterations: String(iterations) })}`, { signal });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}

export async function loadRecorded(region: string, date: string): Promise<RecordedRun | null> {
  const qs = new URLSearchParams({ region, date });
  for (const url of [`/api/agent/cached?${qs}`, `/agent_runs/${region}_${date}.json`]) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (r.ok) return r.json();
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Turn a recorded run into the same event sequence a live run produces. */
export function recordedToEvents(run: RecordedRun): AgentEvent[] {
  const evs: AgentEvent[] = [
    { type: "start", region: run.region, date: run.date, window: run.window, max_mw: run.max_mw, synthetic_jobs: run.synthetic_jobs, grid: run.grid, baseline: run.baseline, iterations_planned: run.iterations.length, data_mode: run.data_mode },
  ];
  let best = run.baseline.score;
  for (const it of run.iterations) {
    evs.push({ type: "thinking", iteration: it.iteration ?? 0 });
    const improved = it.score < best;
    best = Math.min(best, it.score);
    evs.push({ type: "iteration", ...it, improved, best_score: best });
  }
  evs.push({ type: "done", best: run.best, improvement_pct: run.improvement_pct, elapsed_s: run.elapsed_s, saved: true });
  return evs;
}
