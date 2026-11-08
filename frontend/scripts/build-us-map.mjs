// Build lib/us-map.json: SVG paths for the lower-48 states (us-atlas, pre-projected
// Albers USA) plus merged, APPROXIMATE ISO footprints (whole states; real ISO
// boundaries cross state lines). Run: node scripts/build-us-map.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { feature, merge } from "topojson-client";
import { geoPath } from "d3-geo";

const require = createRequire(import.meta.url);
const topo = JSON.parse(readFileSync(require.resolve("us-atlas/states-albers-10m.json"), "utf8"));

// State FIPS -> primary ISO (approximate).
const ISO_STATES = {
  CAISO: ["06"],
  ERCOT: ["48"],
  SPP: ["20", "40", "31", "46"],
  MISO: ["38", "27", "19", "55", "29", "17", "18", "26", "05", "22", "28"],
  PJM: ["42", "34", "24", "10", "11", "51", "54", "39", "21"],
  NYISO: ["36"],
  ISONE: ["23", "33", "50", "25", "44", "09"],
};
const stateIso = Object.fromEntries(Object.entries(ISO_STATES).flatMap(([iso, ids]) => ids.map((id) => [id, iso])));
const EXCLUDE = new Set(["02", "15"]); // Alaska, Hawaii: no ISO in this app

const round = (d) => d.replace(/-?\d+\.\d+/g, (n) => (+n).toFixed(1));
const path = geoPath(); // data is already projected
const geoms = topo.objects.states.geometries.filter((g) => !EXCLUDE.has(g.id));

const states = geoms.map((g) => {
  const f = feature(topo, g);
  return { id: g.id, name: g.properties.name, iso: stateIso[g.id] ?? null, d: round(path(f)) };
});

const isos = {};
for (const [iso, ids] of Object.entries(ISO_STATES)) {
  const m = merge(topo, geoms.filter((g) => ids.includes(g.id)));
  const [cx, cy] = path.centroid(m);
  isos[iso] = { d: round(path(m)), cx: +cx.toFixed(1), cy: +cy.toFixed(1) };
}

const all = feature(topo, { type: "GeometryCollection", geometries: geoms });
const [[x0, y0], [x1, y1]] = path.bounds(all);
const viewBox = [Math.floor(x0) - 4, Math.floor(y0) - 4, Math.ceil(x1 - x0) + 8, Math.ceil(y1 - y0) + 8];

writeFileSync(new URL("../lib/us-map.json", import.meta.url), JSON.stringify({ viewBox, states, isos }));
console.log("states", states.length, "viewBox", viewBox.join(" "));
