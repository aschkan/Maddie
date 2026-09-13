/**
 * `npm run nav-check` — does the navigation view actually DRAW anything?
 *
 * This exists because it should have existed sooner. The tilted map shipped
 * blank twice, and both times a screenshot of the blank map was looked at and
 * explained away: the first time as "that is the stub tile", the second as "the
 * basemap is not reachable from here". A blank rectangle looks the same
 * whatever the reason, which is exactly why it needs a machine to judge it.
 *
 * So this drives a real browser through a real trip and MEASURES THE PIXELS —
 * from the composited screenshot, never from the WebGL canvas, which reads back
 * cleared and reports every map as blank. Three cases, each one a bug that has
 * actually shipped:
 *
 *   route-without-data   the Overpass read FAILED, so there are no stretches.
 *                        The route must still be drawn. It was not: the only
 *                        thing left was a white casing on a pale basemap.
 *   basemap-dead         the tiles never arrive. The view must fall back to the
 *                        flat Leaflet map and say so, not sit there blank. It
 *                        did sit there blank, because `isSourceLoaded` means
 *                        the source DEFINITION parsed, not that a tile came.
 *   layout               nothing runs off the edge at phone or desktop width.
 *
 * NOT part of `npm run check`, deliberately: that suite is offline and opens no
 * socket but loopback, and this needs a built app, a running server and a
 * browser. Run it by hand when the navigation view changes.
 *
 *   npm run build
 *   npx next start -p 8099 &
 *   npm i --no-save playwright        # not a dependency; it is a 300 MB tool
 *   npx playwright install chromium   # unless one is already on the box
 *   npm run nav-check
 *
 * Flags: `--port=8099`, and `--browser=/path/to/chrome` for a Chromium that is
 * already installed somewhere Playwright does not look — which is the case on
 * the machines this app is built on.
 *
 * Every upstream is stubbed, so it needs no network and asserts something this
 * deployment can never assert against the real one: that NOTHING reaches the
 * tile host directly, which is the whole job of the style rewriting.
 */

import { inspect } from "./lib/png.mjs";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PORT = arg("port", "8099");
const BASE = `http://127.0.0.1:${PORT}`;
const HOST = "https://tiles.openfreemap.org";

/** Amsterdam, and a straight walk east with two real maneuvers. */
const LAT = 52.3731;
const LNG = 4.8926;
const PER_DEG = 111_320 * Math.cos((LAT * Math.PI) / 180);
const at = (m) => [LNG + m / PER_DEG, LAT];

const geometry = [];
for (let m = 0; m <= 1800; m += 50) geometry.push(at(m));

const OSRM = {
  code: "Ok",
  routes: [{
    distance: 1800, duration: 1300,
    geometry: { coordinates: geometry },
    legs: [{ steps: [
      { name: "Damstraat", distance: 600, maneuver: { type: "depart", modifier: "", location: at(0) } },
      { name: "Prinsengracht", distance: 700, maneuver: { type: "turn", modifier: "left", location: at(600) } },
      { name: "", distance: 0, maneuver: { type: "arrive", modifier: "", location: at(1800) } },
    ] }],
  }],
};

/** A style that really paints: city blocks, so "blank" and "drawn" differ. */
function livingStyle() {
  const features = [];
  for (let i = -6; i <= 24; i++) {
    for (let j = -6; j <= 6; j++) {
      const x = LNG + (i * 120) / PER_DEG;
      const y = LAT + (j * 120) / 111_320;
      const w = 80 / PER_DEG;
      const h = 80 / 111_320;
      features.push({ type: "Feature", properties: {}, geometry: { type: "Polygon",
        coordinates: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]] } });
    }
  }
  return {
    version: 8,
    glyphs: `${HOST}/fonts/{fontstack}/{range}.pbf`,
    sources: { city: { type: "geojson", data: { type: "FeatureCollection", features } } },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0d1220" } },
      { id: "blocks", type: "fill", source: "city", paint: { "fill-color": "#1b2333" } },
    ],
  };
}

/** A style whose tiles can never arrive — the deployment's real failure. */
function deadStyle() {
  return {
    version: 8,
    sources: { city: { type: "vector", tiles: [`${HOST}/planet/{z}/{x}/{y}.pbf`] } },
    layers: [{ id: "bg", type: "background", paint: { "background-color": "#0d1220" } }],
  };
}

const svg = (fill) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${fill}"/></svg>`,
);

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function trip(browser, { name, style, overpassOk, viewport, wait }) {
  const context = await browser.newContext({
    viewport,
    isMobile: viewport.width < 700,
    hasTouch: viewport.width < 700,
    permissions: ["geolocation"],
    geolocation: { latitude: LAT, longitude: LNG + 400 / PER_DEG, accuracy: 10 },
    colorScheme: "dark",
  });

  const leaked = [];
  await context.route("**://tiles.openfreemap.org/**", (route) => { leaked.push(route.request().url()); route.abort(); });
  // Playwright uses the LAST matching route, so the catch-all goes first.
  await context.route("**/api/osm/vector/**", (route) => route.fulfill({ status: 404, body: "" }));
  await context.route("**/api/osm/vector/styles/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(style) }));
  await context.route("**/api/osm/tile/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg("#11161f") }));
  await context.route("**/api/osm/osrm/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(OSRM) }));
  await context.route("**/api/osm/nominatim/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  /*
   * `overpassOk: false` FAILS the read, and that is what leaves `segments`
   * empty. Returning `{elements: []}` does NOT — every sample then reads
   * "unknown" and you get grey stretches, which is why an earlier version of
   * this check passed while the bug was still there.
   */
  await context.route("**/api/osm/overpass**", (route) => overpassOk
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ elements: [] }) })
    : route.fulfill({ status: 502, contentType: "application/json", body: "{}" }));

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForSelector(".leaflet-container", { timeout: 30_000 });
  await page.waitForTimeout(900);

  const box = await page.locator(".leaflet-container").boundingBox();
  await page.mouse.click(box.x + box.width * 0.30, box.y + box.height * 0.60);
  await page.waitForTimeout(500);
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.42);
  await page.waitForTimeout(2200);

  await page.locator("button.start-trip").scrollIntoViewIfNeeded();
  await page.locator("button.start-trip").click();
  await page.waitForTimeout(wait ?? 5000);

  // The middle band only: the map, not the chrome floating over it.
  const shot = await page.screenshot();
  const painted = inspect(shot, {
    x0: 0, x1: viewport.width,
    y0: Math.round(viewport.height * 0.25), y1: Math.round(viewport.height * 0.75),
  });

  const state = await page.evaluate(() => ({
    tilted: !!document.querySelector(".navmap canvas"),
    flat: !!document.querySelector(".leaflet-container"),
    notes: [...document.querySelectorAll(".nav-note")].map((n) => n.textContent.trim()),
    overflow: [...document.querySelectorAll(".nav-card, .nav-note")]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).length,
  }));

  await context.close();
  return { ...state, ...painted, leaked, errors };
}

const { chromium } = await import("playwright").catch(() => {
  console.error("playwright is not installed. It is not a dependency of this app:\n  npm i --no-save playwright");
  process.exit(2);
});

const browserPath = arg("browser", "");
const browser = await chromium.launch({
  // Headless Chromium has no GPU; MapLibre needs a WebGL context regardless,
  // and SwiftShader is what provides one.
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
  ...(browserPath ? { executablePath: browserPath } : {}),
});

try {
  console.log(`nav-check against ${BASE}\n`);

  console.log("route drawn with NO safety data:");
  const bare = await trip(browser, {
    name: "bare", style: livingStyle(), overpassOk: false, viewport: { width: 390, height: 844 },
  });
  check("the tilted map is up", bare.tilted);
  check("the basemap painted", bare.colours > 20, `${bare.colours} distinct colours`);
  check(
    "the route is visible without stretches",
    bare.top.some(([c]) => { const [r, g, b] = c.split(",").map(Number); return b > 150 && b - r > 40 && b - g > 60; }),
    bare.top.map(([c]) => c).join("  "),
  );
  check("nothing reached the tile host", bare.leaked.length === 0, bare.leaked[0]);
  check("no console errors", bare.errors.length === 0, bare.errors[0]);

  console.log("\nbasemap that never arrives:");
  const dead = await trip(browser, {
    name: "dead", style: deadStyle(), overpassOk: true, viewport: { width: 390, height: 844 }, wait: 12_000,
  });
  check("it fell back to the flat map", dead.flat && !dead.tilted);
  check("and said why", dead.notes.some((n) => /flat map/i.test(n)), dead.notes[0]);

  console.log("\nlayout:");
  for (const viewport of [{ width: 390, height: 844 }, { width: 1224, height: 900 }]) {
    const laid = await trip(browser, { name: "layout", style: livingStyle(), overpassOk: true, viewport });
    check(`nothing runs off the edge at ${viewport.width}px`, laid.overflow === 0, `${laid.overflow} element(s)`);
  }
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nall good" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
