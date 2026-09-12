"use client";

/**
 * Read every candidate route from OpenStreetMap, one after another.
 *
 * One at a time on purpose. Overpass hands out a couple of query slots per IP
 * and answers 429 when you take more, and a rate limit hit while comparing
 * three routes takes out the layers on the map as well — the whole page then
 * looks broken because it asked too much at once.
 *
 * The facts are fetched here; turning them into a score is `score.ts`, and it
 * happens in a `useMemo` in the caller, so changing the hour re-judges the
 * routes without asking OpenStreetMap anything again.
 */

import { useEffect, useState } from "react";

import { fetchFacts, type RouteFacts, type SampleRead } from "@/lib/overpass";
import type { Route } from "@/lib/osrm";

export interface RouteFactsState {
  /** One slot per route, in the same order. Null until that route is read. */
  facts: (RouteFacts | null)[];
  /**
   * The per-point reads behind those counts, one slot per route.
   *
   * Kept beside the totals rather than recomputed: `segments.ts` cuts these
   * into stretches to colour the line and name the worst part of it, and the
   * matching of points to streets they stand on is the expensive part of the
   * whole read. Throwing it away and doing it again would double that cost for
   * numbers we already have.
   */
  reads: (SampleRead[] | null)[];
  /** How many have come back — for "reading route 2 of 3". */
  done: number;
  error: string | null;
}

/** A key that changes when the routes do, but not on every re-render. */
function identity(routes: Route[]): string {
  return routes.map((route) => `${Math.round(route.metres)}/${route.path.length}`).join("|");
}

export function useRouteFacts(routes: Route[]): RouteFactsState {
  const [state, setState] = useState<RouteFactsState>({ facts: [], reads: [], done: 0, error: null });
  const key = identity(routes);

  useEffect(() => {
    const controller = new AbortController();

    // Everything, the reset included, inside the async body: the React
    // Compiler lint rejects a setState reached synchronously from an effect.
    void (async () => {
      if (routes.length === 0) {
        setState({ facts: [], reads: [], done: 0, error: null });
        return;
      }

      const facts: (RouteFacts | null)[] = routes.map(() => null);
      const reads: (SampleRead[] | null)[] = routes.map(() => null);
      setState({ facts: [...facts], reads: [...reads], done: 0, error: null });

      for (let index = 0; index < routes.length; index++) {
        const route = routes[index];
        if (!route) continue;
        const found = await fetchFacts(route.path, { signal: controller.signal });
        if (controller.signal.aborted) return;

        if (found.ok) {
          facts[index] = found.facts;
          reads[index] = found.reads;
          setState({ facts: [...facts], reads: [...reads], done: index + 1, error: null });
        } else if (found.error !== "cancelled") {
          // A failure on one route is not a failure of the page: the ones
          // already read stay on screen, and the reason is said once.
          setState({ facts: [...facts], reads: [...reads], done: index + 1, error: found.error });
        }
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the routes' identity
  }, [key]);

  return state;
}
