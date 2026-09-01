# Maddie — working notes

A women's safety-intelligence platform for the Netherlands. Read `README.md`
first; this file is the short list of things that will bite you while editing.

## The rule everything else serves

A gap in what we could see is never reported as a statement about the place.
Three states, never two: measured-and-fine, measured-and-not, and NOT MEASURED.

- Model it with `Signal<T>` from `src/lib/signal.ts`. Never invent a neutral
  default to stand in for a missing signal — a dimension with no evidence scores
  `null` and lowers overall confidence.
- Every "we could not look" note ends with "That is a gap in the data, not a
  statement about the place." Use `gapNote()` so the wording stays identical.
- An empty list is only ever returned alongside the coverage it was built from.

## Toolchain constraints

- `npm run check` = `tsc --noEmit && eslint . && node --test "test/**/*.test.ts"`.
  It all runs offline.
- Tests run on **Node's type stripping**, with no build step. That means:
  **no TypeScript parameter properties** (`constructor(readonly x: number)`),
  no `enum`, no `namespace`. Write the field and the assignment out.
- For the same reason, relative imports inside `src/` carry the `.ts`
  extension (`allowImportingTsExtensions`). Route handlers and components use
  the `@/` alias, which Next resolves.
- `eslint` is pinned to 9.x: `eslint-plugin-react` is not compatible with 10.
- The React Compiler lint rejects a `setState` reached synchronously from an
  effect body. Fetch-on-mount goes inside `void (async () => { await load(); })()`.

## Things that are load-bearing

- **`src/lib/http/fetch.ts` is the only place an upstream is fetched.** Proxy
  selection, failover and timeouts live there, once. Do not add a per-vendor
  proxy setting.
- Process-wide state (gates, cooldowns, the proxy pool, the cache, the store)
  lives on `globalThis`. Next loads modules in several graphs; module-scope
  state silently becomes several copies, and "concurrency 1" becomes three.
- Overpass is concurrency 1 with per-mirror cooldowns and ONE deadline per
  batch. Raise the concurrency only against a mirror you host.
- StatLine columns are read from `DataProperties`, never hard-coded. Zero rows
  is indistinguishable from zero crime, so any change here needs
  `npm run verify:nl-crime -- <table>` against the live service.
- Point data and area data are different measurements with different curves and
  different confidence. Do not add a fudge factor to make them line up.

## Full trap list

`README.md`, "Traps — bugs already written once". Each one has a test; if you
change the code it guards, keep the test.
