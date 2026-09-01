/**
 * Walking routes from Valhalla. Two units traps live here, and both are
 * silent:
 *
 *  - the shape is an encoded polyline at PRECISION 6. Decoding it at 1e5 puts
 *    the route in the Gulf of Guinea;
 *  - `summary.length` is in KILOMETRES. Reading it as metres understates a
 *    walk by a factor of a thousand, which turns a 40-minute walk into a
 *    number that looks like a doorstep.
 */
import { z } from "zod";
import { getConfig } from "../config.ts";
import { upstreamFetch, UpstreamTimeoutError, UpstreamTransportError } from "../http/fetch.ts";
import { decodePolyline } from "../geo/polyline.ts";
import type { LatLng } from "../geo/wkt.ts";

const Summary = z.object({ length: z.number(), time: z.number() }).loose();

const Trip = z
  .object({
    legs: z
      .array(
        z
          .object({
            shape: z.string().optional(),
            summary: Summary.optional(),
          })
          .loose(),
      )
      .default([]),
    summary: Summary.optional(),
    status: z.number().optional(),
    status_message: z.string().optional(),
  })
  .loose();

const ValhallaResponse = z
  .object({
    trip: Trip.optional(),
    alternates: z.array(z.object({ trip: Trip.optional() }).loose()).default([]),
    error: z.string().optional(),
    error_code: z.number().optional(),
  })
  .loose();

export interface WalkingRoute {
  points: LatLng[];
  /** METRES. Converted from Valhalla's kilometres at the boundary. */
  distanceMetres: number;
  durationSeconds: number;
}

/** Kilometres to metres, at exactly one place in the codebase. */
export function kilometresToMetres(km: number): number {
  return km * 1000;
}

function tripToRoute(trip: z.infer<typeof Trip>): WalkingRoute | null {
  const points: LatLng[] = [];
  let distanceKm = 0;
  let seconds = 0;
  for (const leg of trip.legs) {
    if (typeof leg.shape === "string" && leg.shape !== "") {
      // Precision 6. Not 5.
      const decoded = decodePolyline(leg.shape, 6);
      // Legs share their join point; drop the duplicate.
      points.push(...(points.length > 0 ? decoded.slice(1) : decoded));
    }
    if (leg.summary) {
      distanceKm += leg.summary.length;
      seconds += leg.summary.time;
    }
  }
  if (points.length < 2) return null;
  if (trip.summary) {
    distanceKm = trip.summary.length;
    seconds = trip.summary.time;
  }
  return { points, distanceMetres: kilometresToMetres(distanceKm), durationSeconds: seconds };
}

export function parseValhalla(raw: unknown): WalkingRoute[] {
  const parsed = ValhallaResponse.safeParse(raw);
  if (!parsed.success) return [];
  const routes: WalkingRoute[] = [];
  if (parsed.data.trip) {
    const route = tripToRoute(parsed.data.trip);
    if (route !== null) routes.push(route);
  }
  for (const alternate of parsed.data.alternates) {
    if (!alternate.trip) continue;
    const route = tripToRoute(alternate.trip);
    if (route !== null) routes.push(route);
  }
  return routes;
}

export type RouteOutcome =
  | { ok: true; routes: WalkingRoute[] }
  | { ok: false; reason: "unreachable" | "timeout" | "no-route"; note: string };

export async function walkingRoutes(from: LatLng, to: LatLng, alternates = 2): Promise<RouteOutcome> {
  const config = getConfig();
  const body = JSON.stringify({
    locations: [
      { lat: from.lat, lon: from.lng, type: "break" },
      { lat: to.lat, lon: to.lng, type: "break" },
    ],
    costing: "pedestrian",
    costing_options: { pedestrian: { walking_speed: 4.8, use_lit: 1, sidewalk_factor: 1.2 } },
    // Valhalla reports in kilometres either way; asking explicitly keeps the
    // conversion above honest if a mirror changes its default.
    directions_options: { units: "kilometers" },
    alternates,
    id: "maddie-walk",
  });

  try {
    const response = await upstreamFetch(config.valhallaUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: "no-route",
        note: `The routing service answered ${response.status}. No route was produced; this is not a claim that no route exists.`,
      };
    }
    const routes = parseValhalla(JSON.parse(response.text));
    if (routes.length === 0) {
      return {
        ok: false,
        reason: "no-route",
        note: "The routing service returned no walkable route between those points.",
      };
    }
    return { ok: true, routes };
  } catch (error) {
    if (error instanceof UpstreamTimeoutError) {
      return { ok: false, reason: "timeout", note: "The routing service timed out. No route was produced." };
    }
    if (error instanceof UpstreamTransportError) {
      return { ok: false, reason: "unreachable", note: "The routing service could not be reached, so no route was produced." };
    }
    return { ok: false, reason: "unreachable", note: "The routing service could not be reached, so no route was produced." };
  }
}
