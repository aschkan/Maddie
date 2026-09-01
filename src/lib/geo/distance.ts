import type { LatLng } from "./wkt.ts";

const EARTH_RADIUS_M = 6_371_000;

export function haversineMetres(a: LatLng, b: LatLng): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function bboxAround(centre: LatLng, radiusMetres: number): BBox {
  const latDelta = (radiusMetres / EARTH_RADIUS_M) * (180 / Math.PI);
  const cos = Math.max(0.01, Math.cos((centre.lat * Math.PI) / 180));
  const lngDelta = latDelta / cos;
  return {
    south: centre.lat - latDelta,
    north: centre.lat + latDelta,
    west: centre.lng - lngDelta,
    east: centre.lng + lngDelta,
  };
}

/** Length of a path in metres. */
export function pathLengthMetres(points: readonly LatLng[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversineMetres(points[index - 1]!, points[index]!);
  }
  return total;
}

/**
 * Splits a path into segments of roughly `targetMetres`, so each can be scored
 * on its own. A route is not one number: the walk is safe until the last
 * 300 metres, and that is the part worth telling someone about.
 */
export function segmentPath(points: readonly LatLng[], targetMetres = 250): LatLng[][] {
  if (points.length < 2) return points.length === 1 ? [[points[0]!]] : [];
  const segments: LatLng[][] = [];
  let current: LatLng[] = [points[0]!];
  let accrued = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    accrued += haversineMetres(previous, point);
    current.push(point);
    if (accrued >= targetMetres) {
      segments.push(current);
      current = [point];
      accrued = 0;
    }
  }
  if (current.length > 1) segments.push(current);
  else if (segments.length > 0) segments[segments.length - 1]!.push(...current.slice(1));
  return segments;
}

export function midpoint(points: readonly LatLng[]): LatLng {
  if (points.length === 0) return { lat: 0, lng: 0 };
  const index = Math.floor(points.length / 2);
  return points[index] ?? points[0]!;
}
