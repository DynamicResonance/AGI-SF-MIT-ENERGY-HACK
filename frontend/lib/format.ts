export function fmtEnergy(mwh: number | null | undefined): string {
  if (mwh == null) return "—";
  if (Math.abs(mwh) >= 1e6) return `${(mwh / 1e6).toFixed(2)} TWh`;
  if (Math.abs(mwh) >= 1e3) return `${(mwh / 1e3).toFixed(1)} GWh`;
  return `${Math.round(mwh).toLocaleString("en-US")} MWh`;
}

export function fmtBig(n: number | null | undefined, digits = 1): string {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e15) return `${(n / 1e15).toFixed(digits)} quadrillion`;
  if (a >= 1e12) return `${(n / 1e12).toFixed(digits)} trillion`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(digits)} billion`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(digits)} million`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(digits)}k`;
  return n.toFixed(0);
}

export function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

export function fmtPrice(n: number | null | undefined): string {
  return n == null ? "—" : `$${n.toFixed(2)}/MWh`;
}

export const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
