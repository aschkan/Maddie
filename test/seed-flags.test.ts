import test from "node:test";
import assert from "node:assert/strict";

import { resolveSeedFlags } from "../src/lib/seed-flags.ts";

/**
 * The seed's flag contract, pinned.
 *
 * The rule this file exists for is the one the reverse proxy's 💣 Reseed DB
 * button depends on: `--force` beats every keep/skip switch AND every SEED_*
 * an env file might be carrying. It has to be provable without a database,
 * because the alternative is running a destructive script against a live one
 * and watching what it does — which is not a test anybody runs, and this
 * collection holds things people typed about being assaulted.
 */

test("a bare seed wipes, and writes the example data", () => {
  const flags = resolveSeedFlags();
  assert.equal(flags.force, false);
  assert.equal(flags.keep, false, "destructive by default, like every other platform");
  assert.equal(flags.demo, true);
  assert.equal(flags.error, "");
});

test("--keep spares the reports people typed", () => {
  assert.equal(resolveSeedFlags({ argv: ["--keep"] }).keep, true);
});

test("--no-demo and --clear both mean write nothing", () => {
  assert.equal(resolveSeedFlags({ argv: ["--no-demo"] }).demo, false);
  // --clear is what this script called it before the platforms agreed on one
  // vocabulary, and it is in the README and in every shipped version of the
  // script's header.
  assert.equal(resolveSeedFlags({ argv: ["--clear"] }).demo, false);
});

test("the SEED_* an env file may be carrying are read too", () => {
  assert.equal(resolveSeedFlags({ env: { SEED_KEEP: "1" } }).keep, true);
  assert.equal(resolveSeedFlags({ env: { SEED_NO_DEMO: "1" } }).demo, false);
});

test("--force beats every other switch, in argv and in the environment", () => {
  const flags = resolveSeedFlags({
    argv: ["--keep", "--no-demo", "--clear", "--force"],
    env: { SEED_KEEP: "1", SEED_NO_DEMO: "1" },
  });
  assert.equal(flags.force, true);
  assert.equal(flags.keep, false, "the button wipes even with --keep");
  assert.equal(flags.demo, true, "the button writes the data even with --clear");
});

test("SEED_FORCE=1 is the same switch", () => {
  const flags = resolveSeedFlags({ argv: ["--keep"], env: { SEED_FORCE: "1" } });
  assert.equal(flags.force, true);
  assert.equal(flags.keep, false);
});

test("the numeric options are read, and a bad one is an error rather than a default", () => {
  const good = resolveSeedFlags({ argv: ["--count=400", "--days=90", "--seed=7"] });
  assert.deepEqual([good.total, good.days, good.randomSeed], [400, 90, 7]);
  assert.equal(good.error, "");

  // Defaulting a typo is how you reseed, see the same map, and go looking for
  // the bug somewhere else. This is checked before anything is deleted.
  assert.match(resolveSeedFlags({ argv: ["--count=lots"] }).error, /--count must be/);
  assert.match(resolveSeedFlags({ argv: ["--days=-3"] }).error, /--days must be/);

  const unset = resolveSeedFlags();
  assert.deepEqual([unset.total, unset.days, unset.randomSeed], [null, null, null]);
});
