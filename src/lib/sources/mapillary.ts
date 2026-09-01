/**
 * Mapillary — street-level imagery for the lighting and sightline pass.
 * Free, no card, issued immediately; without it that signal is reported
 * absent rather than guessed at.
 */
import { z } from "zod";
import { getConfig } from "../config.ts";
import { upstreamJson } from "../http/fetch.ts";
import { absent, gapNote, present, type Signal } from "../signal.ts";
import { bboxAround } from "../geo/distance.ts";
import type { LatLng } from "../geo/wkt.ts";

const Image = z
  .object({
    id: z.string(),
    thumb_1024_url: z.string().optional(),
    captured_at: z.union([z.number(), z.string()]).optional(),
    compass_angle: z.number().optional(),
    computed_geometry: z
      .object({ type: z.string().optional(), coordinates: z.array(z.number()).optional() })
      .loose()
      .optional(),
  })
  .loose();

const ImageList = z.object({ data: z.array(Image).default([]) }).loose();

export interface StreetImage {
  id: string;
  url: string;
  /** GeoJSON is [lon, lat] — the same ordering trap as WKT. */
  point: LatLng | null;
  headingDegrees: number | null;
  capturedAt: string | null;
  provider: "mapillary" | "google-street-view";
}

export function parseMapillary(raw: unknown): StreetImage[] {
  const parsed = ImageList.safeParse(raw);
  if (!parsed.success) return [];
  const out: StreetImage[] = [];
  for (const image of parsed.data.data) {
    if (typeof image.thumb_1024_url !== "string") continue;
    const coordinates = image.computed_geometry?.coordinates;
    const point =
      Array.isArray(coordinates) && coordinates.length >= 2 && typeof coordinates[0] === "number" && typeof coordinates[1] === "number"
        ? { lat: coordinates[1], lng: coordinates[0] }
        : null;
    out.push({
      id: image.id,
      url: image.thumb_1024_url,
      point,
      headingDegrees: image.compass_angle ?? null,
      capturedAt:
        typeof image.captured_at === "number"
          ? new Date(image.captured_at).toISOString()
          : typeof image.captured_at === "string"
            ? image.captured_at
            : null,
      provider: "mapillary",
    });
  }
  return out;
}

export async function fetchStreetImages(point: LatLng, limit: number): Promise<Signal<StreetImage[]>> {
  const config = getConfig();
  const source = "Mapillary";
  if (limit <= 0 || !config.streetViewEnabled) {
    return absent("not-configured", source, gapNote("Street-level imagery", "not-configured"));
  }
  if (config.mapillaryToken === "") {
    if (config.googleMapsKey !== "") return googleStreetView(point, limit);
    return absent(
      "not-configured",
      source,
      "No street-imagery key is configured, so lighting and sightlines were not looked at. That is a gap in the data, not a statement about the place.",
    );
  }

  const box = bboxAround(point, 60);
  const url = new URL("https://graph.mapillary.com/images");
  url.searchParams.set("access_token", config.mapillaryToken);
  url.searchParams.set("fields", "id,thumb_1024_url,computed_geometry,captured_at,compass_angle");
  url.searchParams.set("bbox", `${box.west},${box.south},${box.east},${box.north}`);
  url.searchParams.set("limit", String(Math.min(limit * 3, 30)));

  try {
    const images = parseMapillary(await upstreamJson(url.toString())).slice(0, limit);
    if (images.length === 0) {
      return absent("no-coverage", source, gapNote("Street-level imagery", "no-coverage"));
    }
    return present(images, source, 0.6);
  } catch {
    return absent("unreachable", source, gapNote("Street-level imagery", "unreachable"));
  }
}

/**
 * Google Street View Static — denser where it exists, but it needs billing, so
 * it is only ever the second choice.
 */
export function googleStreetView(point: LatLng, limit: number): Signal<StreetImage[]> {
  const config = getConfig();
  const source = "Google Street View Static";
  if (config.googleMapsKey === "") {
    return absent("not-configured", source, gapNote("Street-level imagery", "not-configured"));
  }
  const headings = [0, 90, 180, 270].slice(0, Math.max(1, Math.min(4, limit)));
  const images: StreetImage[] = headings.map((heading) => {
    const url = new URL("https://maps.googleapis.com/maps/api/streetview");
    url.searchParams.set("size", "640x400");
    url.searchParams.set("location", `${point.lat},${point.lng}`);
    url.searchParams.set("heading", String(heading));
    url.searchParams.set("fov", "90");
    url.searchParams.set("pitch", "0");
    url.searchParams.set("key", config.googleMapsKey);
    return {
      id: `sv-${heading}`,
      url: url.toString(),
      point,
      headingDegrees: heading,
      capturedAt: null,
      provider: "google-street-view",
    };
  });
  return present(images, source, 0.55);
}
