/**
 * The dashboard's example reports — invented, deterministic, labelled.
 *
 * ⚠ NOTHING HERE HAPPENED TO ANYBODY. These exist so the evidence dashboard
 * can be looked at, discussed and tested before real reports exist, which is
 * what the supervisors asked for ("even if it's fake, it can spark the
 * discussion"). Every one carries `source: "example"`, and the board says
 * "Synthetic example data" in its subtitle the whole time any of them is shown.
 * They are generated in the browser and never written to `/api/reports`.
 *
 * Shaped, not calibrated: the per-district counts give the bar chart something
 * to compare, the hours cluster in the evening so the time brush has a peak to
 * find, the months bulge in summer and Friday/Saturday evenings are heavier so
 * the area view's line chart and heatmap have a pattern to show. None of those
 * shapes is a finding; they were chosen.
 *
 * Points are scattered inside each district's OUTLINE, never at a doorway.
 */

import type { City } from "./cities.ts";
import { pointInPolygon, type ReportType } from "./evidence.ts";
import type { Report } from "./reports.ts";
import { noteFor, rng } from "./seed-data.ts";

/** Reports per district per type. Districts not listed get `FALLBACK`. */
const COUNTS: Record<string, Record<string, Record<ReportType, number>>> = {
  amsterdam: {
    centrum: { harassment: 124, catcalling: 86, assault: 37, other: 52 },
    west: { harassment: 50, catcalling: 20, assault: 25, other: 15 },
    oost: { harassment: 35, catcalling: 15, assault: 15, other: 13 },
    zuid: { harassment: 26, catcalling: 11, assault: 11, other: 10 },
  },
  utrecht: {
    binnenstad: { harassment: 124, catcalling: 86, assault: 37, other: 52 },
    west: { harassment: 38, catcalling: 18, assault: 16, other: 14 },
    oost: { harassment: 44, catcalling: 20, assault: 19, other: 16 },
    noordoost: { harassment: 29, catcalling: 8, assault: 16, other: 8 },
  },
};
const FALLBACK: Record<ReportType, number> = { harassment: 20, catcalling: 10, assault: 8, other: 8 };

/** Evening-heavy, with a long quiet night and a small lunchtime bump. */
const HOUR_WEIGHTS = [3, 3, 3, 2, 3, 3, 2, 3, 4, 6, 6, 5, 7, 9, 6, 9, 13, 23, 27, 35, 30, 26, 13, 7];
/** Jan…Dec — a summer bulge. */
const MONTH_WEIGHTS = [6, 6, 7, 8, 9, 11, 12, 12, 9, 8, 7, 6];
/** Sun…Sat (`Date.getDay`) — Friday and Saturday heavier. */
const WEEKDAY_WEIGHTS = [8, 6, 6, 7, 8, 12, 13];

/** The year the examples fall in. Fixed, so every session sees the same chart. */
export const EXAMPLE_YEAR = 2025;

function pick(weights: readonly number[], roll: number): number {
  const total = weights.reduce((sum, value) => sum + value, 0);
  let mark = roll * total;
  for (let i = 0; i < weights.length; i++) {
    mark -= weights[i] ?? 0;
    if (mark <= 0) return i;
  }
  return weights.length - 1;
}

/** A store category for a dashboard type — the finest one it groups. */
const CATEGORY: Record<ReportType, string> = {
  harassment: "harassment", catcalling: "catcalling", assault: "assault", other: "other",
};

export function exampleReports(city: City): Report[] {
  const random = rng(hash(city.id));
  const counts = COUNTS[city.id] ?? {};
  const out: Report[] = [];

  for (const district of city.districts) {
    const perType = counts[district.id] ?? FALLBACK;
    const lats = district.outline.map((point) => point.lat);
    const lngs = district.outline.map((point) => point.lng);
    const box = {
      south: Math.min(...lats), north: Math.max(...lats),
      west: Math.min(...lngs), east: Math.max(...lngs),
    };

    for (const [type, count] of Object.entries(perType) as [ReportType, number][]) {
      for (let n = 0; n < count; n++) {
        // Rejection sampling inside the outline. Bounded, so a degenerate
        // outline cannot spin; it falls back to the label point.
        let point = district.label;
        for (let tries = 0; tries < 40; tries++) {
          // Rounded BEFORE the test, so the stored point is the one tested.
          const candidate = {
            lat: Number((box.south + random() * (box.north - box.south)).toFixed(5)),
            lng: Number((box.west + random() * (box.east - box.west)).toFixed(5)),
          };
          if (pointInPolygon(candidate, district.outline)) {
            point = candidate;
            break;
          }
        }

        const month = pick(MONTH_WEIGHTS, random());
        const hour = pick(HOUR_WEIGHTS, random());
        const wantDay = pick(WEEKDAY_WEIGHTS, random());
        const when = new Date(EXAMPLE_YEAR, month, 1 + Math.floor(random() * 28), hour, Math.floor(random() * 60));
        // Nudge to the weekday drawn, within the same month.
        const shift = (wantDay - when.getDay() + 7) % 7;
        if (when.getDate() + shift <= 28) when.setDate(when.getDate() + shift);

        const category = CATEGORY[type];
        const note = noteFor(category, random(), random());
        out.push({
          id: `example-${city.id}-${district.id}-${type}-${n}`,
          category,
          point,
          at: when.toISOString(),
          ...(note ? { note } : {}),
          source: "example",
          area: district.name,
        });
      }
    }
  }

  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function hash(text: string): number {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0;
}
