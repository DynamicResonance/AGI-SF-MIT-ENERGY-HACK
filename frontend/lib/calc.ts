/**
 * Pure calculation module: energy in the midday dip -> tokens -> dollars.
 * No I/O, no React. Everything is hourly: one value per local clock hour,
 * in MW averaged over the hour (== MWh for that hour).
 */
import { Assumptions, REFERENCE_DC_MW, WINDOW_RULES } from "./assumptions";

export type Series = (number | null)[];

export interface DaySeries {
  date: string; // YYYY-MM-DD, local to the region
  load: Series; // gross load, MW, length 24
  solar: Series;
  wind: Series;
  net: Series; // load - solar - wind
  curtailment: Series | null; // MWh per hour; null = ISO doesn't publish it
  lmp: Series | null; // $/MWh; null = not available
}

/** Half-open window [start, end) in local clock hours. */
export interface Window {
  start: number;
  end: number;
}

export interface DipDetection {
  window: Window;
  detected: boolean; // false => fallback window used
  eveningPeakMw: number | null;
  eveningPeakHour: number | null;
  thresholdMw: number | null;
}

export interface Headroom {
  conservativeMwh: number | null; // curtailed renewable energy in the window
  optimisticMwh: number; // sum of (evening peak - net load) over the window
  missingHours: number;
}

export interface TokenEconomics {
  facilityMwh: number;
  itKwh: number;
  gpuHours: number;
  tokens: number;
  usd: number;
  dataCenterDays: number; // in units of REFERENCE_DC_MW x 24h
}

export interface PriceStats {
  windowAvg: number | null;
  eveningAvg: number | null;
  spreadPerMwh: number | null; // eveningAvg - windowAvg
  nonPositiveHours: number; // hours in window with LMP <= 0
  windowHours: number;
}

export interface DayResult {
  date: string;
  dip: DipDetection;
  window: Window; // window actually used (override or detected)
  headroom: Headroom;
  conservative: TokenEconomics | null;
  optimistic: TokenEconomics;
  prices: PriceStats | null;
}

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export function maxIn(series: Series, from: number, to: number): { value: number; hour: number } | null {
  let best: { value: number; hour: number } | null = null;
  for (let h = from; h < to && h < series.length; h++) {
    const v = series[h];
    if (isNum(v) && (best === null || v > best.value)) best = { value: v, hour: h };
  }
  return best;
}

export function meanIn(series: Series, from: number, to: number): number | null {
  let sum = 0;
  let n = 0;
  for (let h = from; h < to && h < series.length; h++) {
    const v = series[h];
    if (isNum(v)) {
      sum += v;
      n++;
    }
  }
  return n ? sum / n : null;
}

/** net = load - solar - wind, per hour (null if load missing; missing solar/wind treated as 0). */
export function netLoad(load: Series, solar: Series, wind: Series): Series {
  return load.map((l, h) => (isNum(l) ? l - (isNum(solar[h]) ? solar[h]! : 0) - (isNum(wind[h]) ? wind[h]! : 0) : null));
}

/**
 * Detect the contiguous midday window where net load < threshold% of the evening peak.
 * Takes the run of qualifying daylight hours that contains the lowest net-load hour.
 */
export function detectDipWindow(net: Series, thresholdPct: number): DipDetection {
  const [ps, pe] = WINDOW_RULES.eveningPeakHours;
  const [ss, se] = WINDOW_RULES.dipSearchHours;
  const [fs, fe] = WINDOW_RULES.fallbackWindow;
  const fallback = (peak: { value: number; hour: number } | null, thr: number | null): DipDetection => ({
    window: { start: fs, end: fe },
    detected: false,
    eveningPeakMw: peak?.value ?? null,
    eveningPeakHour: peak?.hour ?? null,
    thresholdMw: thr,
  });

  const peak = maxIn(net, ps, pe);
  if (!peak) return fallback(null, null);
  const thr = (thresholdPct / 100) * peak.value;
  const qualifies = (h: number) => h >= ss && h < se && isNum(net[h]) && (net[h] as number) < thr;

  let minHour = -1;
  for (let h = ss; h < se; h++) {
    if (qualifies(h) && (minHour < 0 || (net[h] as number) < (net[minHour] as number))) minHour = h;
  }
  if (minHour < 0) return fallback(peak, thr);

  let start = minHour;
  let end = minHour + 1;
  while (qualifies(start - 1)) start--;
  while (qualifies(end)) end++;
  return { window: { start, end }, detected: true, eveningPeakMw: peak.value, eveningPeakHour: peak.hour, thresholdMw: thr };
}

/** Two headroom layers over the window. Each hourly value is MW-average == MWh. */
export function computeHeadroom(day: DaySeries, w: Window, eveningPeakMw: number | null): Headroom {
  let optimistic = 0;
  let conservative: number | null = day.curtailment ? 0 : null;
  let missing = 0;
  for (let h = w.start; h < w.end; h++) {
    const n = day.net[h];
    if (isNum(n) && isNum(eveningPeakMw)) optimistic += Math.max(0, eveningPeakMw - n);
    else missing++;
    if (conservative !== null) {
      const c = day.curtailment![h];
      if (isNum(c)) conservative += Math.max(0, c);
    }
  }
  return { conservativeMwh: conservative, optimisticMwh: optimistic, missingHours: missing };
}

/** Energy (facility MWh) -> IT energy -> GPU-hours -> tokens -> USD. */
export function energyToTokens(facilityMwh: number, a: Assumptions): TokenEconomics {
  const itKwh = (facilityMwh * 1000) / a.pue;
  const tokensPerKwh = (a.tokensPerSecPerGpu * 3600) / a.kwPerGpu;
  const tokens = itKwh * tokensPerKwh * a.utilization;
  return {
    facilityMwh,
    itKwh,
    gpuHours: itKwh / a.kwPerGpu,
    tokens,
    usd: (tokens / 1e6) * a.usdPerMTokens,
    dataCenterDays: facilityMwh / (REFERENCE_DC_MW * 24),
  };
}

export function computePrices(lmp: Series | null, w: Window): PriceStats | null {
  if (!lmp || !lmp.some(isNum)) return null;
  const [es, ee] = WINDOW_RULES.eveningPriceHours;
  const windowAvg = meanIn(lmp, w.start, w.end);
  const eveningAvg = meanIn(lmp, es, ee);
  let nonPositive = 0;
  let hours = 0;
  for (let h = w.start; h < w.end; h++) {
    const v = lmp[h];
    if (isNum(v)) {
      hours++;
      if (v <= 0) nonPositive++;
    }
  }
  return {
    windowAvg,
    eveningAvg,
    spreadPerMwh: isNum(windowAvg) && isNum(eveningAvg) ? eveningAvg - windowAvg : null,
    nonPositiveHours: nonPositive,
    windowHours: hours,
  };
}

/** Full single-day computation. `override` replaces the detected window. */
export function computeDay(day: DaySeries, a: Assumptions, override?: Window | null): DayResult {
  const dip = detectDipWindow(day.net, a.dipThresholdPct);
  const window = override ?? dip.window;
  const headroom = computeHeadroom(day, window, dip.eveningPeakMw);
  return {
    date: day.date,
    dip,
    window,
    headroom,
    conservative: headroom.conservativeMwh === null ? null : energyToTokens(headroom.conservativeMwh, a),
    optimistic: energyToTokens(headroom.optimisticMwh, a),
    prices: computePrices(day.lmp, window),
  };
}

export interface Annualized {
  daysUsed: number;
  daysWithCurtailment: number;
  avgDailyConservativeMwh: number | null;
  avgDailyOptimisticMwh: number | null;
  conservative: TokenEconomics | null; // per year
  optimistic: TokenEconomics | null; // per year
}

/** A day counts toward the average only if it has (nearly) all 24 hours of net load. */
export function isCompleteDay(day: DaySeries, maxMissing = 2): boolean {
  return day.net.filter(isNum).length >= 24 - maxMissing;
}

/**
 * Daily -> annual: mean of daily headroom over the given (trailing) days x 365.
 * Each day uses its own detected window unless a fixed override window is given.
 */
export function annualize(days: DaySeries[], a: Assumptions, override?: Window | null): Annualized {
  const complete = days.filter((d) => isCompleteDay(d));
  const results = complete.map((d) => computeDay(d, a, override));
  const opt = results.map((r) => r.headroom.optimisticMwh);
  const cons = results.map((r) => r.headroom.conservativeMwh).filter(isNum);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const avgOpt = avg(opt);
  const avgCons = avg(cons);
  return {
    daysUsed: results.length,
    daysWithCurtailment: cons.length,
    avgDailyConservativeMwh: avgCons,
    avgDailyOptimisticMwh: avgOpt,
    conservative: avgCons === null ? null : energyToTokens(avgCons * 365, a),
    optimistic: avgOpt === null ? null : energyToTokens(avgOpt * 365, a),
  };
}
