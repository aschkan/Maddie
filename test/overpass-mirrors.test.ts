import test from "node:test";
import assert from "node:assert/strict";

import { SERVICES } from "../src/lib/osm-forward.ts";

/*
 * Every Overpass mirror in the rotation must hold the WHOLE planet.
 *
 * A regional instance answers a query outside its region with a 200 and an
 * empty list — indistinguishable, to the code reading it, from a place nobody
 * has mapped. `overpass.osm.ch` (Switzerland only) sat in this list and did
 * exactly that to Dutch queries, silently, cached for ten minutes at a time.
 */

/**
 * Hosts CONFIRMED to serve a regional extract — checked by querying them for a
 * Dutch bounding box, not assumed from the domain. Add to this, never remove.
 */
const REGIONAL = [/osm\.ch\b/];

test("no regional Overpass instance is in the rotation", () => {
  const overpass = SERVICES.overpass;
  assert.ok(overpass);
  for (const base of overpass.bases) {
    for (const pattern of REGIONAL) {
      assert.doesNotMatch(base, pattern, `${base} serves a regional extract — its empty answers read as unmapped streets`);
    }
  }
});
