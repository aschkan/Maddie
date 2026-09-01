/**
 * verify-nl-crime — prove the Dutch crime table end to end, against the live
 * service, using the app's own parsing code.
 *
 * StatLine retires and renumbers tables. A wrong id returns zero rows, and
 * zero rows is indistinguishable from zero crime — which is the one failure
 * this whole app exists to avoid. So this script is the gate: nothing ships
 * until it passes.
 *
 *   node scripts/verify-nl-crime.ts                    discovery
 *   node scripts/verify-nl-crime.ts 47022NED           verify one table
 *   node scripts/verify-nl-crime.ts 47022NED --labels  and print its offences
 */
import { readFileSync } from "node:fs";

// A .env file is loaded by Next, but not by a bare node process.
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match === null) continue;
    const [, key, rawValue] = match;
    if (key === undefined || process.env[key] !== undefined) continue;
    process.env[key] = (rawValue ?? "").replace(/^["']|["']$/g, "").split(" #")[0]?.trim() ?? "";
  }
} catch {
  /* no .env is fine; the app must run with an empty environment */
}

const { getConfig } = await import("../src/lib/config.ts");
const { upstreamJson, proxyStatus } = await import("../src/lib/http/fetch.ts");
const {
  fetchCodeList,
  fetchDataProperties,
  fetchTableInfo,
  fetchTypedDataSet,
  odataQuote,
  periodFilter,
  pickTopic,
  resolveShape,
} = await import("../src/lib/sources/statline.ts");
const { classifyOffence, isRollUpLabel, monthCodes, summariseCrimeRows, CRIME_CATEGORIES } = await import(
  "../src/lib/sources/nl-crime.ts"
);

const GREEN = "\u001b[32m";
const RED = "\u001b[31m";
const DIM = "\u001b[2m";
const BOLD = "\u001b[1m";
const RESET = "\u001b[0m";

const pass = (message: string): void => console.log(`${GREEN}  ok${RESET}  ${message}`);
const fail = (message: string): void => console.log(`${RED}fail${RESET}  ${message}`);
const note = (message: string): void => console.log(`${DIM}      ${message}${RESET}`);

const CATALOGUES = ["https://dataderden.cbs.nl", "https://opendata.cbs.nl"];

interface CatalogueRow {
  Identifier?: string;
  Title?: string;
  ShortTitle?: string;
  Period?: string;
  Frequency?: string;
  Updated?: string;
}

/** Discovery: search BOTH catalogues, because crime lives in only one of them. */
async function discover(): Promise<void> {
  console.log(`${BOLD}Searching both StatLine catalogues for crime tables${RESET}\n`);
  let found = 0;

  for (const catalogue of CATALOGUES) {
    const url = `${catalogue}/ODataCatalog/Tables?$format=json&$select=Identifier,Title,ShortTitle,Period,Frequency,Updated`;
    console.log(`${BOLD}${catalogue}${RESET}`);
    try {
      const body = await upstreamJson<{ value?: CatalogueRow[] }>(url, { timeoutMs: 60_000 });
      const rows = body.value ?? [];
      const matches = rows.filter((row) => /misdrijf|misdrijven|overlast|criminaliteit/i.test(row.Title ?? ""));
      if (matches.length === 0) {
        note(`${rows.length} tables listed, none matching misdrijven/overlast`);
        continue;
      }
      for (const row of matches) {
        found += 1;
        const geo = /wijk|buurt/i.test(row.Title ?? "")
          ? "wijk/buurt"
          : /gemeente/i.test(row.Title ?? "")
            ? "gemeente (too coarse)"
            : "?";
        const time = /maand/i.test(row.Title ?? "")
          ? "monthly"
          : /jaar/i.test(row.Title ?? "")
            ? "yearly (too coarse)"
            : "?";
        console.log(`  ${BOLD}${row.Identifier}${RESET}  ${row.Title}`);
        note(`geography ${geo} - period ${time} - covers ${row.Period ?? "?"}`);
      }
    } catch (error) {
      fail(`${catalogue} could not be read: ${error instanceof Error ? error.message : String(error)}`);
      note("If everything fails here, the network cannot reach CBS. Check UPSTREAM_PROXY_URL.");
    }
    console.log("");
  }

  if (found === 0) {
    fail("No crime tables were found. This is a connectivity problem, not evidence that none exist.");
    process.exitCode = 1;
    return;
  }
  console.log(`Now prove one end to end:  ${BOLD}node scripts/verify-nl-crime.ts 47022NED --labels${RESET}`);
}

/** Verify: shape, months, real rows, non-null values, category spread. */
async function verify(table: string, showLabels: boolean): Promise<void> {
  const config = getConfig();
  const client = { base: config.crimeODataUrl, table };
  console.log(`${BOLD}Verifying ${table} at ${client.base}${RESET}\n`);

  let failures = 0;
  const check = (ok: boolean, message: string): boolean => {
    if (ok) pass(message);
    else {
      fail(message);
      failures += 1;
    }
    return ok;
  };

  const info = await fetchTableInfo(client).catch(() => null);
  if (!check(info !== null, `TableInfos answered${info === null ? "" : `: ${info.title}`}`)) {
    note("A table id that does not exist answers the same way as a network failure. Check both.");
    process.exitCode = 1;
    return;
  }
  note(`period coverage: ${info!.period || "unstated"} - last modified ${info!.modified || "unstated"}`);

  const properties = await fetchDataProperties(client);
  check(properties.length > 0, `DataProperties returned ${properties.length} columns`);

  const shape = resolveShape(properties);
  if (
    !check(
      shape !== null,
      shape === null
        ? "the table shape could NOT be resolved"
        : `shape resolved: region=${shape.regionKey} period=${shape.periodKey} dimensions=[${shape.dimensionKeys.join(", ")}]`,
    )
  ) {
    note("Remember GeoDetail does not contain the substring 'Dimension'.");
    process.exitCode = 1;
    return;
  }

  const regionProperty = properties.find((property) => property.Key === shape!.regionKey);
  check(
    regionProperty !== undefined && ["GeoDimension", "GeoDetail"].includes(regionProperty.Type),
    `region column is a ${regionProperty?.Type ?? "?"} (GeoDetail is the trap - it has no "Dimension" in it)`,
  );

  const topicKey = pickTopic(shape!, "geregistreerde");
  check(topicKey !== null, `topic column resolved to ${topicKey} (the _N suffix is CBS's collision marker)`);

  const offenceKey = shape!.dimensionKeys[0] ?? "";
  check(offenceKey !== "", `offence dimension resolved to ${offenceKey}`);

  // A real Amsterdam buurt: Burgwallen-Oude Zijde.
  const regionList = await fetchCodeList(client, shape!.regionKey, "BU03630000");
  const regionKey = regionList[0]?.key ?? null;
  check(regionKey !== null, `region key found: ${JSON.stringify(regionKey)} (CBS pads these with spaces)`);
  if (regionKey === null) {
    process.exitCode = 1;
    return;
  }

  const months = monthCodes(new Date(), config.crimeWindowMonths);
  note(`asking for ${months.length} months: ${months[0]} to ${months.at(-1)} (the most recent is skipped for lag)`);
  check(
    months.every((month) => /^\d{4}MM\d{2}$/.test(month)),
    "every period is an enumerated month code - no JJ annual codes, no lexicographic range",
  );

  const filter = `${shape!.regionKey} eq ${odataQuote(regionKey)} and ${periodFilter(shape!.periodKey, months)}`;
  const rows = await fetchTypedDataSet(client, filter);
  check(rows.length > 0, `TypedDataSet returned ${rows.length} rows`);
  if (rows.length === 0) {
    note("Zero rows and zero crime are indistinguishable here. Treat this as a FAILURE, never as a quiet street.");
    process.exitCode = 1;
    return;
  }

  const labelRows = await fetchCodeList(client, offenceKey);
  const labels = new Map(labelRows.map((row) => [row.key.trim(), row.title]));
  check(labels.size > 0, `${labels.size} offence labels resolved`);

  const rollUps = labelRows.filter((row) => isRollUpLabel(row.title));
  check(
    rollUps.length > 0,
    `${rollUps.length} roll-up rows identified for exclusion${rollUps.length > 0 ? ` (e.g. "${rollUps[0]!.title}")` : ""}`,
  );
  note('The roll-up is labelled "Misdrijven, totaal" - with a comma. Missing it doubles every figure.');

  const summary = summariseCrimeRows({
    rows,
    shape: shape!,
    offenceKey,
    topicKey: topicKey!,
    labels,
    requestedPeriods: months,
    table,
    area: { level: "buurt", code: "BU03630000", name: "Burgwallen-Oude Zijde" },
  });

  check(
    summary.monthsObserved === months.length,
    `${summary.monthsObserved}/${months.length} months present${summary.monthsObserved < months.length ? " - police figures lag; the rate divides by what came back" : ""}`,
  );
  check(
    summary.totalCount > 0,
    `${summary.totalCount} offences counted (roll-ups excluded: ${summary.rollUpRowsExcluded} rows)`,
  );
  check(
    summary.suppressedCells < rows.length,
    `${summary.suppressedCells} suppressed cells, treated as "not published" rather than zero`,
  );

  const otherShare = summary.totalCount === 0 ? 1 : summary.byCategory.other / summary.totalCount;
  check(otherShare < 0.4, `${Math.round(otherShare * 100)}% of offences fell into "other" (must stay under 40%)`);

  console.log("\n  category spread");
  for (const category of CRIME_CATEGORIES) {
    const count = summary.byCategory[category];
    if (count === 0) continue;
    note(`${category.padEnd(26)} ${String(count).padStart(5)}`);
  }
  note(`${"severity-weighted per month".padEnd(26)} ${summary.severityPerMonth.toFixed(2)}`);

  if (showLabels) {
    console.log("\n  offence labels, and how each classifies");
    for (const row of labelRows) {
      const marker = isRollUpLabel(row.title) ? `${DIM}roll-up (excluded)${RESET}` : classifyOffence(row.title);
      note(`${row.key.trim().padEnd(8)} ${row.title.padEnd(52)} ${marker}`);
    }
  }

  const status = proxyStatus();
  if (status.usable > 0) {
    console.log("\n  proxy pool");
    for (const entry of status.entries) {
      note(
        `${entry.url} tier ${entry.tier}${entry.resting ? " (resting)" : ""}${entry.lastError === null ? "" : ` - ${entry.lastError}`}`,
      );
    }
  }

  console.log("");
  if (failures > 0) {
    fail(`${failures} checks failed. Do not ship on this table.`);
    process.exitCode = 1;
    return;
  }

  console.log(`${GREEN}${BOLD}All checks passed.${RESET} Paste these into env/maddie.env:\n`);
  console.log(`NL_CRIME_ODATA_URL=${config.crimeODataUrl}`);
  console.log(`NL_CRIME_TABLE=${table}`);
  console.log(`NL_CRIME_WINDOW_MONTHS=${config.crimeWindowMonths}`);
  console.log("CRIME_DATA_ENABLED=true");
}

const args = process.argv.slice(2).filter((argument) => argument !== "--");
const table = args.find((argument) => !argument.startsWith("--"));
const showLabels = args.includes("--labels");

if (table === undefined) await discover();
else await verify(table, showLabels);
