import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import {
  END, hsl, LIGHT, MEANINGS, PLACE, POLICE, REPORT, ROUTE, START, type Swatch,
} from "../src/lib/palette.ts";
import { VERDICT_EXPLAIN, VERDICT_LABEL } from "../src/lib/verdict.ts";
import { FACTORS } from "../src/lib/score.ts";
import { CRIME_BAND_LABEL } from "../src/lib/nl-crime.ts";

/*
 * The design system's rules, as tests. `docs/Maddie-Design-System.md` is the
 * spec; these are the parts of it a code change can quietly break.
 */

const tones = (swatch: Swatch) => [swatch.day, swatch.night];

/** How much colour a colour has, 0–1: the spread between its channels. */
function chroma(hex: string): number {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (Math.max(...channels) - Math.min(...channels)) / 255;
}

test("no colour on the map is purple", () => {
  // Purple meant the destination, "still loading" AND a crime report at once,
  // and a participant read the reports as places to visit. It is retired from
  // the map entirely so it cannot come back meaning two things.
  for (const entry of MEANINGS) {
    for (const hex of tones(entry.swatch)) {
      const { h, s } = hsl(hex);
      if (s < 0.15) continue;
      assert.ok(h < 250 || h > 320, `${entry.meaning} (${hex}) is purple — hue ${Math.round(h)}°`);
    }
  }
});

test("no colour on the map is an alarm red", () => {
  // The far end of the route scale is "look closer", not "danger". A rust
  // brown says that; a pure red says the other thing.
  for (const entry of MEANINGS) {
    for (const hex of tones(entry.swatch)) {
      const { h, s } = hsl(hex);
      if (s < 0.15) continue;
      assert.ok(h >= 10 && h <= 345, `${entry.meaning} (${hex}) reads as red — hue ${Math.round(h)}°`);
    }
  }
});

test("one colour, one meaning: no two meanings share a colour", () => {
  for (const tone of ["day", "night"] as const) {
    const seen = new Map<string, string>();
    for (const entry of MEANINGS) {
      const hex = entry.swatch[tone].toLowerCase();
      const before = seen.get(hex);
      assert.equal(before, undefined, `${tone}: "${entry.meaning}" and "${before}" are both ${hex}`);
      seen.set(hex, entry.meaning);
    }
  }
});

test("the start and the destination carry no hue — colour is kept for evidence", () => {
  // "Why does the starting point need a colour?" — it does not. The ends of a
  // trip are not evidence about the streets.
  for (const hex of [...tones(START), ...tones(END)]) {
    // CHROMA, not HSL saturation: near-black ink has a high saturation and no
    // visible hue at all.
    assert.ok(chroma(hex) < 0.1, `${hex} carries a hue — an end of the trip should not`);
  }
  // …and they still differ from each other, by lightness, in both tones.
  for (const tone of ["day", "night"] as const) {
    assert.ok(Math.abs(hsl(START[tone]).l - hsl(END[tone]).l) > 0.15, `A and B are too alike at ${tone}`);
  }
});

test("police figures are a texture in a neutral ink, never a hue a report could be confused with", () => {
  for (const hex of tones(POLICE)) assert.ok(chroma(hex) < 0.15, `${hex} carries too much hue for the police hatch`);
  assert.notEqual(POLICE.day, REPORT.day);
});

test("the stylesheet's tokens are the palette's colours", () => {
  // The chips in the panel and the lines on the map must be the same colours,
  // or the list and the map are two answers instead of one.
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const block = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `no ${selector} block`);
    return css.slice(at, css.indexOf("\n}", at));
  };
  const light = block(":root");
  const dark = block('[data-theme="dark"]');
  const pairs: [string, Swatch][] = [
    ["--route-good", ROUTE.good], ["--route-fair", ROUTE.fair], ["--route-poor", ROUTE.poor],
    ["--route-unknown", ROUTE.unknown], ["--light", LIGHT], ["--place", PLACE], ["--report", REPORT],
    ["--police", POLICE], ["--trip-start", START], ["--trip-end", END],
  ];
  for (const [token, swatch] of pairs) {
    assert.match(light, new RegExp(`${token}:\\s*${swatch.day}`, "i"), `${token} by day should be ${swatch.day}`);
    assert.match(dark, new RegExp(`${token}:\\s*${swatch.night}`, "i"), `${token} at night should be ${swatch.night}`);
  }
  assert.doesNotMatch(css, /--crime\b/, "the purple crime token is gone and must stay gone");
});

const UNSAID = /\b(safe|unsafe|safest|danger|dangerous)\b/i;

test("no label a participant reads says safe or danger", () => {
  // "Telling somebody that this is safe is a lot of responsibility." Say what
  // the evidence is; let the reader conclude.
  const labels = [
    ...Object.values(VERDICT_LABEL), ...Object.values(VERDICT_EXPLAIN),
    ...FACTORS.flatMap((factor) => [factor.label, factor.explain]),
    ...Object.values(CRIME_BAND_LABEL),
    ...MEANINGS.map((entry) => entry.meaning),
  ];
  for (const label of labels) assert.doesNotMatch(label, UNSAID, label);
});

test("no text on the participant's screens says safe or danger", () => {
  // JSX text between tags, in every component a participant sees. The
  // research view is the study team's and quotes the protocol's own wording.
  const dir = new URL("../src/components/", import.meta.url);
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".tsx") || file === "ResearchPanel.tsx" || file === "ResearchView.tsx") continue;
    const source = readFileSync(new URL(file, dir), "utf8")
      // Comments are for whoever edits this, not for the person on the map.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const match of source.matchAll(/>([^<>{}]+)</g)) {
      assert.doesNotMatch(match[1] ?? "", UNSAID, `${file}: "${(match[1] ?? "").trim()}"`);
    }
  }
});
