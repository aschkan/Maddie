/**
 * What the proxy chain is doing.
 *
 * The one page to open when the map is empty. It answers the three questions
 * in order: is a chain configured at all, has anything been found to work, and
 * if not, what did the failures say.
 */

import { NextResponse } from "next/server";

import { pool } from "@/lib/proxy-pool";

export const dynamic = "force-dynamic";

export async function GET() {
  const proxies = pool();
  const summary = proxies.summary();

  const failures = proxies.states
    .filter((state) => state.ok === false && state.lastError)
    .slice(0, 8)
    .map((state) => `${state.hop.label}: ${state.lastError}`);

  return NextResponse.json(
    {
      ...summary,
      // The failure that is not a dead proxy, called out by name: a Squid-style
      // entry proxy allows CONNECT to 443 and nothing else out of the box, and
      // every hop in the list is on some other port.
      likelyEntryAcl:
        summary.working === 0 &&
        summary.total > 0 &&
        failures.length > 0 &&
        failures.filter((line) => /refused with 403/.test(line)).length === failures.length,
      sampleFailures: failures,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
