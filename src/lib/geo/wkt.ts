/**
 * PDOK returns coordinates as WKT: `POINT(lon lat)` — LONGITUDE FIRST.
 * Reversing them puts Amsterdam in Somalia, and every downstream number
 * (crime, venues, routes) is then computed about the Gulf of Aden without a
 * single error being raised.
 */
export interface LatLng {
  lat: number;
  lng: number;
}

const POINT = /^\s*POINT\s*\(\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s+(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*\)\s*$/i;

export function parseWktPoint(raw: string | null | undefined): LatLng | null {
  if (typeof raw !== "string") return null;
  const match = POINT.exec(raw);
  if (match === null) return null;
  const lng = Number(match[1]);
  const lat = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}
