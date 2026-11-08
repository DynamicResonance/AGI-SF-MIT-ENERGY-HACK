import { REFERENCE_DC_MW, WINDOW_RULES } from "@/lib/assumptions";
import { hh } from "@/lib/format";

const F = ({ children }: { children: React.ReactNode }) => (
  <code className="block rounded-md px-3 py-2 my-1 text-sm" style={{ background: "var(--surface-2)" }}>{children}</code>
);

export default function HowWeCalculate() {
  const [ps, pe] = WINDOW_RULES.eveningPeakHours;
  const [es, ee] = WINDOW_RULES.eveningPriceHours;
  const [fs, fe] = WINDOW_RULES.fallbackWindow;
  return (
    <section className="card p-6 flex flex-col gap-4 text-[15px] leading-relaxed">
      <h2 className="text-xl font-semibold">How we calculate</h2>
      <div>
        <b>1. Net load (the duck).</b> For every hour of the day (local time, hourly averages):
        <F>net load = gross load − solar − wind</F>
        It is the demand that dispatchable plants (gas, hydro, imports, batteries) must cover.
      </div>
      <div>
        <b>2. The dip window.</b> The evening peak is the highest net load between {hh(ps)} and {hh(pe)}.
        The window is the run of daylight hours where net load is below a threshold share of that peak
        (default 50%), around the lowest point. If none qualifies we fall back to {hh(fs)}–{hh(fe)}.
        You can drag the window yourself.
      </div>
      <div>
        <b>3. Two layers of headroom, always shown separately.</b>
        <F>Conservative = Σ curtailed renewable MWh in the window</F>
        Energy that was produced, but thrown away. Only some ISOs publish this.
        <F>Optimistic = Σ (evening peak − net load) × 1 h over the window</F>
        The grid already has to be able to serve the evening peak; at midday that capacity sits idle.
      </div>
      <div>
        <b>4. Energy → tokens.</b>
        <F>IT energy (kWh) = headroom MWh × 1000 ÷ PUE</F>
        <F>tokens per kWh = tokens/sec per GPU × 3600 ÷ kW per GPU</F>
        <F>tokens = IT energy × tokens per kWh × utilization</F>
        <F>GPU-hours = IT energy ÷ kW per GPU · {REFERENCE_DC_MW} MW data-center-days = MWh ÷ ({REFERENCE_DC_MW} MW × 24 h)</F>
      </div>
      <div>
        <b>5. Tokens → money.</b>
        <F>value = tokens ÷ 1,000,000 × price per million tokens</F>
      </div>
      <div>
        <b>6. Cost advantage.</b> Average day-ahead hub price in the window vs. {hh(es)}–{hh(ee)}; the difference is
        what each MWh saves by being shifted to midday. We also count window hours where price was zero or negative.
      </div>
      <div>
        <b>7. Annualized.</b> We don&apos;t multiply one hand-picked day by 365. We average the trailing N days (default 30)
        ending on the selected date, each with its own detected window, then × 365. Spring is the high season for
        the dip, so a 30-day spring average overstates a full year; choose 365 days for the defensible number.
      </div>
    </section>
  );
}
