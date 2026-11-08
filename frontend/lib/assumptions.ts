/**
 * ALL DEFAULT ASSUMPTIONS LIVE HERE.
 *
 * Every number below is an *assumption*, not data. The UI labels them as such,
 * and every one can be changed with a slider. Each has a source / rationale so
 * it can be defended on stage. Reference workload: a ~70B-parameter open model
 * (Llama-2/3-70B class) served with batching on NVIDIA H100 SXM.
 */

export interface Assumptions {
  /** Power Usage Effectiveness: facility energy / IT energy. */
  pue: number;
  /** kW drawn per GPU *including* its share of server, CPU, network, fans. */
  kwPerGpu: number;
  /** Sustained output tokens/sec per GPU at full batch. */
  tokensPerSecPerGpu: number;
  /** Fraction of powered GPU time actually producing tokens at that rate (0-1). */
  utilization: number;
  /** Market price of output tokens, USD per million tokens. */
  usdPerMTokens: number;
  /** Dip window = contiguous midday hours with net load below this % of the evening net-load peak. */
  dipThresholdPct: number;
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  // PUE 1.2 — modern purpose-built AI/hyperscale facility. Google reports a
  // fleet-wide trailing-12-month PUE of ~1.09-1.10; Uptime Institute's 2024
  // global survey average is ~1.56 (mostly legacy enterprise rooms). 1.2 sits
  // between: achievable for new GPU halls, not best-in-class.
  pue: 1.2,

  // 1.3 kW/GPU — NVIDIA DGX H100 system spec: 10.2 kW max for 8 GPUs
  // (= 1.275 kW/GPU incl. CPUs, NICs, fans, storage). Rounded up to 1.3.
  // Max (not typical) draw is deliberately conservative: fewer tokens/kWh.
  kwPerGpu: 1.3,

  // 2,700 tok/s/GPU — MLPerf Inference v4.0, Llama-2-70B, 8x H100 (TensorRT-LLM):
  // ~21,806 tok/s offline (batch) and ~20,556 tok/s server -> ~2,570-2,726 per GPU.
  // "Offline" is the right scenario for deferrable batch/background work.
  // Real deployments with long contexts run lower; the utilization factor
  // below absorbs that gap.
  tokensPerSecPerGpu: 2700,

  // 0.7 — haircut for real-world serving: imperfect batching, longer contexts
  // than the benchmark, scheduling gaps, ramp in/out of the window.
  utilization: 0.7,

  // $0.60 / M output tokens — Llama-3.3-70B hosted API prices seen in 2026:
  // DeepInfra ~$0.40/M output, Together AI ~$0.88-1.04/M. $0.60 is a
  // mid-to-low value (batch/deferred work typically gets a discount).
  usdPerMTokens: 0.6,

  // 50% — methodological choice, not physics: the midday trough is "dip" when
  // net load is below half of what the system must serve at the evening peak.
  // Users can override the window directly with the slider.
  dipThresholdPct: 50,
};

/** Fixed methodological constants (hours are local clock hours, start-of-interval). */
export const WINDOW_RULES = {
  /** Evening net-load peak is searched in [16:00, 23:00). */
  eveningPeakHours: [16, 23] as const,
  /** Average "evening peak" price is taken over [17:00, 21:00). */
  eveningPriceHours: [17, 21] as const,
  /** Dip is searched only in daylight [06:00, 19:00). */
  dipSearchHours: [6, 19] as const,
  /** Fallback window if no dip is detected. */
  fallbackWindow: [9, 14] as const,
};

/** Size of the "reference data center" used for the equivalence metric. */
export const REFERENCE_DC_MW = 100;

/** Default number of trailing days averaged for the annual extrapolation. */
export const DEFAULT_ANNUALIZE_DAYS = 30;
export const ANNUALIZE_DAY_OPTIONS = [7, 30, 90, 365] as const;

/** One-line source/rationale shown under each slider (full detail in comments above). */
export const ASSUMPTION_SOURCES: Record<keyof Assumptions, string> = {
  pue: "Modern AI facility. Google fleet ≈1.10; Uptime Institute 2024 global avg ≈1.56.",
  kwPerGpu: "NVIDIA DGX H100: 10.2 kW max for 8 GPUs incl. CPUs, network, fans → 1.275 kW.",
  tokensPerSecPerGpu: "MLPerf Inference v4.0, Llama-2-70B, 8×H100: ~21.8k tok/s offline → ~2.7k/GPU.",
  utilization: "Haircut for real serving: batching gaps, longer contexts, ramp in/out of the window.",
  usdPerMTokens: "Llama-3.3-70B APIs (2026): DeepInfra ~$0.40/M, Together ~$0.88–1.04/M output.",
  dipThresholdPct: "Method choice: 'dip' = net load below this share of the evening net-load peak.",
};

/** Slider ranges for the assumptions drawer. */
export const SLIDER_RANGES: Record<keyof Assumptions, { min: number; max: number; step: number; label: string; unit: string }> = {
  pue: { min: 1.05, max: 2.0, step: 0.01, label: "PUE", unit: "" },
  kwPerGpu: { min: 0.5, max: 2.5, step: 0.05, label: "kW per GPU (incl. server)", unit: "kW" },
  tokensPerSecPerGpu: { min: 100, max: 12000, step: 50, label: "Tokens/sec per GPU", unit: "tok/s" },
  utilization: { min: 0.1, max: 1.0, step: 0.05, label: "Utilization", unit: "" },
  usdPerMTokens: { min: 0.05, max: 15, step: 0.05, label: "Price per million tokens", unit: "$" },
  dipThresholdPct: { min: 10, max: 95, step: 1, label: "Dip threshold (% of evening peak)", unit: "%" },
};
