/**
 * The seed's flags, as pure data.
 *
 * The rules these encode are not Maddie's to choose: every platform behind the
 * reverse proxy answers the same `npm run seed -- --force` from the same 💣
 * Reseed DB button, and the contract is written down in that repo's README
 * under "The seed contract". This is that contract for this app.
 *
 * It is a separate module, and pure, so the one rule the button depends on can
 * actually be TESTED — `--force` beats every keep/skip switch AND every SEED_*
 * an env file might be carrying. Computed inline in the script from
 * `process.argv` at import time, the only way to check it would be to run the
 * whole seed against a live database and watch what it did, which is not a test
 * anybody runs, so the guarantee would have been a comment.
 */

export interface SeedFlags {
  /** The panel's button. Ignores every other switch, in argv and in the env. */
  force: boolean;
  /**
   * Do not wipe.
   *
   * For this app that means the old default: drop the example reports and
   * REPLACE them, leaving every report a person typed exactly where it is.
   */
  keep: boolean;
  /** Write the example reports. `--no-demo` (or `--clear`) turns this off. */
  demo: boolean;
  /** How many example reports, over how many days, from which pseudo-random seed. */
  total: number | null;
  days: number | null;
  randomSeed: number | null;
  /** Non-empty when a numeric option was given something that is not a number. */
  error: string;
}

function numeric(
  args: string[],
  name: string,
  problems: string[],
): number | null {
  const prefix = `--${name}=`;
  const found = args.find((argument) => argument.startsWith(prefix));
  if (found === undefined) return null;
  const raw = found.slice(prefix.length);
  const parsed = Number(raw);
  // Rejected rather than defaulted. `--count=lots` silently becoming the
  // default count is how you reseed and wonder why nothing changed; and this
  // is checked BEFORE anything is deleted, so a typo costs nothing.
  if (!Number.isFinite(parsed) || parsed < 0) {
    problems.push(`--${name} must be a non-negative number, got "${raw}"`);
    return null;
  }
  return parsed;
}

export function resolveSeedFlags({
  argv = [] as string[],
  env = {} as Record<string, string | undefined>,
} = {}): SeedFlags {
  const args = new Set(argv);
  const has = (flag: string, envVar: string) => args.has(flag) || env[envVar] === "1";

  const force = has("--force", "SEED_FORCE");
  const keep = !force && has("--keep", "SEED_KEEP");
  // `--clear` is what this script called "wipe and write nothing" before the
  // platforms agreed on one vocabulary. It still works — it is in the header of
  // every version of this file that has shipped, and in the README.
  const demo = force || !(has("--no-demo", "SEED_NO_DEMO") || args.has("--clear"));

  const problems: string[] = [];
  const total = numeric(argv, "count", problems);
  const days = numeric(argv, "days", problems);
  const randomSeed = numeric(argv, "seed", problems);

  return { force, keep, demo, total, days, randomSeed, error: problems.join("; ") };
}
