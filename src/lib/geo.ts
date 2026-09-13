/**
 * The small amount of geometry the safety read needs.
 *
 * Distances here use an equirectangular approximation rather than haversine:
 * over the few kilometres of a walking route the error is centimetres, and this
 * runs tens of thousands of times while matching route samples to streets.
 */

import type { LatLng } from "./osrm.ts";

const EARTH_M = 6_371_000;
const RAD = Math.PI / 180;

/** Metres between two points. */
export function distanceM(a: LatLng, b: LatLng): number {
  const meanLat = ((a.lat + b.lat) / 2) * RAD;
  const dx = (b.lng - a.lng) * RAD * Math.cos(meanLat);
  const dy = (b.lat - a.lat) * RAD;
  return Math.sqrt(dx * dx + dy * dy) * EARTH_M;
}

/** Total length of a path, in metres. */
export function pathLengthM(path: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const previous = path[i - 1];
    const current = path[i];
    if (previous && current) total += distanceM(previous, current);
  }
  return total;
}

/** Metres from a point to a line segment — not just to its ends. */
export function distanceToSegmentM(point: LatLng, a: LatLng, b: LatLng): number {
  const meanLat = point.lat * RAD;
  const scale = Math.cos(meanLat);
  const px = point.lng * scale;
  const py = point.lat;
  const ax = a.lng * scale;
  const ay = a.lat;
  const bx = b.lng * scale;
  const by = b.lat;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  // A zero-length segment is a point; projecting onto it divides by zero.
  let t = lengthSquared === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));

  const nearest = { lat: ay + t * dy, lng: (ax + t * dx) / scale };
  return distanceM(point, nearest);
}

/** Shortest distance from a point to any part of a path. */
export function distanceToPathM(point: LatLng, path: LatLng[]): number {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  const only = path[0];
  if (path.length === 1 && only) return distanceM(point, only);

  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    const d = distanceToSegmentM(point, a, b);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Points along a route, one roughly every `everyM` metres.
 *
 * The route is sampled rather than walked way-by-way because OSRM returns a
 * line, not a list of OSM ways — there is no id to look up. Each sample is then
 * matched to whatever street it is standing on.
 */
export function samplePath(path: LatLng[], everyM = 25): LatLng[] {
  const first = path[0];
  if (!first) return [];
  if (path.length === 1) return [first];

  const samples: LatLng[] = [first];
  let carried = 0;

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;

    const segment = distanceM(a, b);
    if (segment === 0) continue;

    let travelled = everyM - carried;
    while (travelled <= segment) {
      const t = travelled / segment;
      samples.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
      travelled += everyM;
    }
    carried = (carried + segment) % everyM;
  }

  const last = path[path.length - 1];
  if (last) samples.push(last);
  return samples;
}

/** A bounding box around a path, grown by `padM` metres on every side. */
export function boundsAround(path: LatLng[], padM: number): {
  south: number; west: number; north: number; east: number;
} | null {
  const first = path[0];
  if (!first) return null;

  let south = first.lat;
  let north = first.lat;
  let west = first.lng;
  let east = first.lng;
  for (const p of path) {
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
    if (p.lng < west) west = p.lng;
    if (p.lng > east) east = p.lng;
  }

  const latPad = (padM / EARTH_M) / RAD;
  // Longitude degrees shrink towards the poles, so the pad has to widen.
  const cos = Math.max(0.01, Math.cos(((south + north) / 2) * RAD));
  const lngPad = latPad / cos;

  return { south: south - latPad, west: west - lngPad, north: north + latPad, east: east + lngPad };
}
