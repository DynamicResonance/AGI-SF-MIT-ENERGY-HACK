import { describe, expect, it } from "vitest";
import { Assumptions } from "./assumptions";
import {
  DaySeries,
  annualize,
  computeDay,
  computeHeadroom,
  computePrices,
  detectDipWindow,
  energyToTokens,
  netLoad,
} from "./calc";

/*
 * HAND-CHECKED EXAMPLE
 * --------------------
 * Net load: 20,000 MW every hour, except
 *   09:00-13:59 (5 hours) = 5,000 MW   <- the dip
 *   19:00               = 30,000 MW   <- evening peak
 * Curtailment: 1,000 MWh in each dip hour, 0 elsewhere.
 * LMP: 9h=-5, 10h=-5, 11h=0, 12h=10, 13h=10; 17-20h = 80; else 30.
 *
 * Threshold 50% of 30,000 = 15,000 MW -> only hours 9..13 qualify -> window [9,14).
 * Optimistic  = 5 h x (30,000 - 5,000) = 125,000 MWh
 * Conservative = 5 h x 1,000           =   5,000 MWh
 *
 * Simple assumptions: PUE 1.25, 1.0 kW/GPU, 1,000 tok/s, utilization 0.5, $1/M tokens.
 * Conservative 5,000 MWh:
 *   IT energy   = 5,000 / 1.25        = 4,000 MWh = 4,000,000 kWh
 *   tokens/kWh  = 1,000 x 3600 / 1.0  = 3,600,000
 *   tokens      = 4e6 x 3.6e6 x 0.5   = 7.2e12
 *   USD         = 7.2e12 / 1e6 x $1   = $7,200,000
 *   GPU-hours   = 4e6 kWh / 1.0 kW    = 4,000,000
 *   100MW-DC-days = 5,000 / 2,400     = 2.08333
 * Prices: window avg = (-5-5+0+10+10)/5 = 2; evening [17,21) avg = 80; spread = 78;
 *   non-positive hours = 3 (9, 10, 11).
 */
const SIMPLE: Assumptions = {
  pue: 1.25,
  kwPerGpu: 1.0,
  tokensPerSecPerGpu: 1000,
  utilization: 0.5,
  usdPerMTokens: 1,
  dipThresholdPct: 50,
};

function exampleDay(date = "2026-04-22"): DaySeries {
  const net = Array.from({ length: 24 }, (_, h) => (h >= 9 && h <= 13 ? 5000 : h === 19 ? 30000 : 20000));
  const curtailment = Array.from({ length: 24 }, (_, h) => (h >= 9 && h <= 13 ? 1000 : 0));
  const lmpMap: Record<number, number> = { 9: -5, 10: -5, 11: 0, 12: 10, 13: 10, 17: 80, 18: 80, 19: 80, 20: 80 };
  const lmp = Array.from({ length: 24 }, (_, h) => lmpMap[h] ?? 30);
  // load = net + solar (wind 0) so netLoad() reproduces net exactly
  const solar = Array.from({ length: 24 }, (_, h) => (h >= 9 && h <= 13 ? 15000 : 0));
  const load = net.map((n, h) => n + solar[h]);
  return { date, load, solar, wind: Array(24).fill(0), net, curtailment, lmp };
}

describe("netLoad", () => {
  it("subtracts solar and wind, treats missing renewables as 0, keeps missing load null", () => {
    expect(netLoad([100, 100, null], [10, null, 5], [20, 30, 1])).toEqual([70, 70, null]);
  });
});

describe("detectDipWindow", () => {
  it("finds the contiguous low-net-load window (hand-checked)", () => {
    const d = detectDipWindow(exampleDay().net, 50);
    expect(d.detected).toBe(true);
    expect(d.window).toEqual({ start: 9, end: 14 });
    expect(d.eveningPeakMw).toBe(30000);
    expect(d.eveningPeakHour).toBe(19);
    expect(d.thresholdMw).toBe(15000);
  });

  it("falls back to 09:00-14:00 when nothing is below threshold", () => {
    const flat = Array(24).fill(20000);
    const d = detectDipWindow(flat, 50);
    expect(d.detected).toBe(false);
    expect(d.window).toEqual({ start: 9, end: 14 });
  });

  it("picks the run containing the minimum when two runs qualify", () => {
    const net = Array(24).fill(20000);
    net[19] = 30000;
    net[7] = 10000; // short early run
    net[11] = 2000;
    net[12] = 3000; // deeper run
    expect(detectDipWindow(net, 50).window).toEqual({ start: 11, end: 13 });
  });

  it("ignores low night hours outside the daylight search range", () => {
    const net = Array(24).fill(20000);
    net[19] = 30000;
    net[3] = 1000;
    expect(detectDipWindow(net, 50).detected).toBe(false);
  });

  it("handles negative net load (more renewables than load)", () => {
    const net = Array(24).fill(20000);
    net[19] = 30000;
    net[12] = -2000;
    const d = detectDipWindow(net, 50);
    expect(d.window).toEqual({ start: 12, end: 13 });
  });
});

describe("computeHeadroom", () => {
  it("computes both layers (hand-checked)", () => {
    const h = computeHeadroom(exampleDay(), { start: 9, end: 14 }, 30000);
    expect(h.optimisticMwh).toBe(125000);
    expect(h.conservativeMwh).toBe(5000);
    expect(h.missingHours).toBe(0);
  });

  it("returns null conservative layer when ISO has no curtailment data", () => {
    const day = { ...exampleDay(), curtailment: null };
    expect(computeHeadroom(day, { start: 9, end: 14 }, 30000).conservativeMwh).toBeNull();
  });

  it("never counts hours above the peak as negative headroom", () => {
    const day = exampleDay();
    expect(computeHeadroom(day, { start: 19, end: 20 }, 30000).optimisticMwh).toBe(0);
  });
});

describe("energyToTokens", () => {
  it("converts MWh to tokens and dollars (hand-checked)", () => {
    const t = energyToTokens(5000, SIMPLE);
    expect(t.itKwh).toBeCloseTo(4_000_000, 6);
    expect(t.gpuHours).toBeCloseTo(4_000_000, 6);
    expect(t.tokens).toBeCloseTo(7.2e12, 0);
    expect(t.usd).toBeCloseTo(7_200_000, 4);
    expect(t.dataCenterDays).toBeCloseTo(2.083333, 5);
  });

  it("is linear in energy and price", () => {
    const a = energyToTokens(1000, SIMPLE);
    const b = energyToTokens(2000, { ...SIMPLE, usdPerMTokens: 2 });
    expect(b.tokens).toBeCloseTo(2 * a.tokens, 0);
    expect(b.usd).toBeCloseTo(4 * a.usd, 6);
  });
});

describe("computePrices", () => {
  it("computes window vs evening averages and non-positive hours (hand-checked)", () => {
    const p = computePrices(exampleDay().lmp, { start: 9, end: 14 })!;
    expect(p.windowAvg).toBe(2);
    expect(p.eveningAvg).toBe(80);
    expect(p.spreadPerMwh).toBe(78);
    expect(p.nonPositiveHours).toBe(3);
    expect(p.windowHours).toBe(5);
  });

  it("returns null without LMP data", () => {
    expect(computePrices(null, { start: 9, end: 14 })).toBeNull();
  });
});

describe("computeDay", () => {
  it("ties everything together; override replaces detected window", () => {
    const r = computeDay(exampleDay(), SIMPLE);
    expect(r.window).toEqual({ start: 9, end: 14 });
    expect(r.conservative!.usd).toBeCloseTo(7_200_000, 4);
    const o = computeDay(exampleDay(), SIMPLE, { start: 10, end: 12 });
    expect(o.headroom.optimisticMwh).toBe(50000);
    expect(o.headroom.conservativeMwh).toBe(2000);
    expect(o.dip.window).toEqual({ start: 9, end: 14 }); // detection still reported
  });
});

describe("annualize", () => {
  it("averages complete days and multiplies by 365", () => {
    const d1 = exampleDay("2026-04-21");
    const d2 = { ...exampleDay("2026-04-22"), curtailment: Array(24).fill(0) };
    const partial = { ...exampleDay("2026-04-23"), net: exampleDay().net.map((v, h) => (h > 12 ? null : v)) };
    const a = annualize([d1, d2, partial], SIMPLE);
    expect(a.daysUsed).toBe(2); // partial day excluded
    expect(a.avgDailyOptimisticMwh).toBe(125000);
    expect(a.avgDailyConservativeMwh).toBe(2500); // (5000 + 0) / 2
    expect(a.conservative!.facilityMwh).toBe(2500 * 365);
  });

  it("returns null conservative when no day has curtailment data", () => {
    const d = { ...exampleDay(), curtailment: null };
    const a = annualize([d], SIMPLE);
    expect(a.conservative).toBeNull();
    expect(a.daysWithCurtailment).toBe(0);
  });
});
