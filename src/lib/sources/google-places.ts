/**
 * Google Places (New) — the ONE capability with no open substitute.
 *
 * Review text is the only source for "do the staff here step in when a woman
 * is being bothered". OSM has the venues but no reviews, and no open dataset
 * has that sentence in it. Without the key the signal is reported MISSING —
 * never papered over with the venue's star rating, which measures the coffee.
 */
import { z } from "zod";
import { getConfig } from "../config.ts";
import { upstreamFetch } from "../http/fetch.ts";
import { absent, gapNote, present, type Signal } from "../signal.ts";
import type { LatLng } from "../geo/wkt.ts";

const PLACES_BASE = "https://places.googleapis.com/v1";

const Place = z
  .object({
    id: z.string().optional(),
    displayName: z.object({ text: z.string().optional() }).loose().optional(),
    location: z.object({ latitude: z.number(), longitude: z.number() }).loose().optional(),
    types: z.array(z.string()).default([]),
    rating: z.number().optional(),
    userRatingCount: z.number().optional(),
    currentOpeningHours: z.object({ openNow: z.boolean().optional() }).loose().optional(),
    formattedAddress: z.string().optional(),
  })
  .loose();

const Review = z
  .object({
    name: z.string().optional(),
    rating: z.number().optional(),
    text: z.object({ text: z.string().optional(), languageCode: z.string().optional() }).loose().optional(),
    originalText: z.object({ text: z.string().optional() }).loose().optional(),
    relativePublishTimeDescription: z.string().optional(),
    publishTime: z.string().optional(),
  })
  .loose();

const SearchResponse = z.object({ places: z.array(Place).default([]) }).loose();
const DetailsResponse = z.object({ reviews: z.array(Review).default([]) }).loose();

export interface GooglePlace {
  id: string;
  name: string;
  point: LatLng | null;
  types: string[];
  rating: number | null;
  ratingCount: number | null;
  openNow: boolean | null;
  address: string | null;
}

export interface VenueReview {
  text: string;
  rating: number | null;
  when: string | null;
}

export function parsePlaces(raw: unknown): GooglePlace[] {
  const parsed = SearchResponse.safeParse(raw);
  if (!parsed.success) return [];
  const out: GooglePlace[] = [];
  for (const place of parsed.data.places) {
    if (typeof place.id !== "string") continue;
    out.push({
      id: place.id,
      name: place.displayName?.text ?? "",
      point: place.location ? { lat: place.location.latitude, lng: place.location.longitude } : null,
      types: place.types,
      rating: place.rating ?? null,
      ratingCount: place.userRatingCount ?? null,
      openNow: place.currentOpeningHours?.openNow ?? null,
      address: place.formattedAddress ?? null,
    });
  }
  return out;
}

export function parseReviews(raw: unknown): VenueReview[] {
  const parsed = DetailsResponse.safeParse(raw);
  if (!parsed.success) return [];
  const out: VenueReview[] = [];
  for (const review of parsed.data.reviews) {
    const text = review.text?.text ?? review.originalText?.text ?? "";
    if (text.trim() === "") continue;
    out.push({
      text: text.trim(),
      rating: review.rating ?? null,
      when: review.relativePublishTimeDescription ?? review.publishTime ?? null,
    });
  }
  return out;
}

export function googleConfigured(): boolean {
  return getConfig().googleMapsKey !== "";
}

async function placesCall<T>(path: string, fieldMask: string, body?: unknown): Promise<T> {
  const config = getConfig();
  const response = await upstreamFetch(`${PLACES_BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": config.googleMapsKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Places API answered ${response.status}`);
  return JSON.parse(response.text) as T;
}

export async function searchVenues(
  query: string,
  centre: LatLng,
  radiusMetres: number,
): Promise<Signal<GooglePlace[]>> {
  const source = "Google Places";
  if (!googleConfigured()) {
    return absent("not-configured", source, gapNote("Google Places", "not-configured"));
  }
  try {
    const body = await placesCall<unknown>(
      "/places:searchText",
      "places.id,places.displayName,places.location,places.types,places.rating,places.userRatingCount,places.currentOpeningHours.openNow,places.formattedAddress",
      {
        textQuery: query,
        locationBias: {
          circle: { center: { latitude: centre.lat, longitude: centre.lng }, radius: radiusMetres },
        },
        maxResultCount: 20,
      },
    );
    return present(parsePlaces(body), source, 0.7);
  } catch {
    return absent("unreachable", source, gapNote("Google Places", "unreachable"));
  }
}

/**
 * Review text for one venue. The signal that matters is not the star rating —
 * it is whether anybody wrote about being followed, hassled, or looked after.
 */
export async function venueReviews(placeId: string): Promise<Signal<VenueReview[]>> {
  const source = "Google Places reviews";
  if (!googleConfigured()) {
    return absent(
      "not-configured",
      source,
      "Venue reviews need a Google Places key, which is not configured here. Nothing is known about how this place treats women on their own — that is a gap in the data, not a statement about the place.",
    );
  }
  try {
    const body = await placesCall<unknown>(`/places/${encodeURIComponent(placeId)}`, "reviews");
    const reviews = parseReviews(body);
    if (reviews.length === 0) return absent("no-coverage", source, gapNote("Venue reviews", "no-coverage"));
    return present(reviews, source, 0.6);
  } catch {
    return absent("unreachable", source, gapNote("Venue reviews", "unreachable"));
  }
}
