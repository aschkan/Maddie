declare module "tz-lookup" {
  /** Latitude, longitude → IANA timezone name. Offline, bundled, no request. */
  export default function tzlookup(lat: number, lon: number): string;
}
