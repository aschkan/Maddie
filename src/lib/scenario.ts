/**
 * The interview scenario — one controlled situation in Utrecht.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * The study's first round of interviews needs every participant to look at the
 * SAME map: the same start, the same few destinations, the same routes, the
 * same reports, the same lighting data. Otherwise two people disagreeing about
 * which way round to walk might simply have been shown different streets,
 * and the disagreement — which is the finding — cannot be read.
 *
 * So the scenario does not ask the internet anything that decides what the
 * participant sees:
 *
 *   * The ROUTES and the per-point reads behind their scores were recorded once
 *     by `npm run scenario` (`scripts/scenario.ts`) into
 *     `scenario-recording.json`, from the same OSRM and Overpass this app
 *     normally asks live. Replaying them means a rate limit, a slow proxy or a
 *     changed OSM tag cannot change what participant 14 saw compared with
 *     participant 3. It also means the session works on a laptop with no
 *     network beyond the basemap tiles.
 *   * The REPORTS are the real ones (Pointer's survey and the study's own,
 *     from the database). They are not part of the recording: there is no
 *     invented data in this app any more, so a session shows what the
 *     database holds that day — re-check before a round of interviews.
 *   * The score is still computed LIVE from the recorded reads, by the same
 *     `assess()` as everything else. Moving the hour slider or switching a
 *     factor off in Layers re-scores the recorded streets exactly as it would
 *     re-score live ones — the scenario controls the inputs, not the logic.
 *
 */

import type { LayerData } from "./layers.ts";
import type { LatLng, Profile, Route } from "./osrm.ts";
import type { RouteFacts, SampleRead } from "./overpass.ts";

export interface ScenarioPlace {
  id: string;
  label: string;
  /** One line under the label: why this destination is in the scenario. */
  note: string;
  point: LatLng;
  /**
   * Extra ways round, each forced through one point.
   *
   * OSRM's own alternatives are often a single route on foot — a city centre
   * has one obviously shortest way — and one route is nothing to compare. So
   * each destination names streets a person might plausibly choose instead:
   * along a canal, through a park, down the high street. Recorded as routes
   * in their own right; the app does not know or care that a via point made
   * them.
   */
  via?: LatLng[];
}

/**
 * Where everybody starts. The station hall, from Nominatim.
 *
 * The supervisor's framing: "now you have to decide from Utrecht Central to go
 * somewhere". A station at night is also the place most participants will have
 * a real memory of, which is what the first half of the interview asks for.
 */
export const SCENARIO_START: ScenarioPlace = {
  id: "centraal",
  label: "Utrecht Centraal",
  note: "Station hall",
  point: { lat: 52.08938, lng: 5.1096 },
};

/**
 * Three destinations, chosen to differ in the way that matters.
 *
 * A short one through the busy centre, a medium one out to a residential area
 * past the railway and parkland, and a long one most people would cycle. Each
 * gives OSRM room to offer more than one way round — a destination with a
 * single sensible route has nothing to compare, and comparing is the task.
 */
export const SCENARIO_DESTINATIONS: ScenarioPlace[] = [
  {
    id: "biltstraat",
    label: "Biltstraat",
    note: "1.7 km — through the city centre",
    point: { lat: 52.09501, lng: 5.12623 },
    via: [
      { lat: 52.09060, lng: 5.12150 }, // Domplein — the old centre, busy until late
      { lat: 52.09640, lng: 5.12020 }, // the Wittevrouwensingel — canal-side, quiet
    ],
  },
  {
    id: "overvecht",
    label: "Overvecht",
    note: "3 km — student housing, past the railway",
    point: { lat: 52.11012, lng: 5.12576 },
    via: [
      { lat: 52.09960, lng: 5.12420 }, // through the Griftpark
      { lat: 52.10300, lng: 5.10900 }, // up the Amsterdamsestraatweg
    ],
  },
  {
    id: "science-park",
    label: "Utrecht Science Park",
    note: "4.6 km — the university campus",
    point: { lat: 52.08541, lng: 5.17584 },
    via: [
      { lat: 52.08620, lng: 5.13700 }, // across the Wilhelminapark
      { lat: 52.09550, lng: 5.13900 }, // out along the Biltstraat
    ],
  },
];

/** The modes the recording covers. Driving is not part of the study. */
export const SCENARIO_PROFILES: Profile[] = ["walking", "cycling"];

/** 22:00 — after dark all year in the Netherlands, so lighting matters. */
export const SCENARIO_HOUR = 22;

/** A recorded route: the line OSRM drew, and what Overpass said along it. */
export interface RecordedRoute extends Route {
  facts: RouteFacts;
  reads: SampleRead[];
}

export interface ScenarioRecording {
  /** ISO time the recording was made. Printed in the scenario's info sheet. */
  recordedAt: string;
  /** Where each part came from, so the provenance is in the file. */
  sources: { routing: string; overpass: string };
  /** `${destinationId}|${profile}` → the routes OSRM offered, in its order. */
  legs: Record<string, RecordedRoute[]>;
  /** Places, lamps and lit streets within a few hundred metres of any route. */
  layers: LayerData;
}

export function legKey(destinationId: string, profile: Profile): string {
  return `${destinationId}|${profile}`;
}

export function destinationById(id: string | null): ScenarioPlace | null {
  return SCENARIO_DESTINATIONS.find((place) => place.id === id) ?? null;
}

/**
 * The routes for one destination and mode, or none.
 *
 * Driving is never recorded, so asking for it returns an empty list rather than
 * falling back to a live request: the whole point is that nothing in a session
 * goes out to the network and comes back different.
 */
export function recordedLeg(
  recording: ScenarioRecording | null,
  destinationId: string | null,
  profile: Profile,
): RecordedRoute[] {
  if (!recording || !destinationId) return [];
  return recording.legs[legKey(destinationId, profile)] ?? [];
}

/**
 * Whatever came out of the JSON file → a recording, or null.
 *
 * The file is committed and written by a script, but a hand edit or a
 * half-finished recording run must not render a broken map in front of a
 * participant. A leg with an unusable route is dropped; a file with no legs at
 * all is not a recording.
 */
export function parseRecording(raw: unknown): ScenarioRecording | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Partial<ScenarioRecording>;
  if (!body.legs || typeof body.legs !== "object") return null;

  const legs: Record<string, RecordedRoute[]> = {};
  for (const [key, value] of Object.entries(body.legs)) {
    if (!Array.isArray(value)) continue;
    const routes = value.filter((route): route is RecordedRoute =>
      Boolean(route)
      && Array.isArray(route.path) && route.path.length >= 2
      && typeof route.metres === "number" && typeof route.seconds === "number"
      && Boolean(route.facts) && Array.isArray(route.reads),
    );
    if (routes.length > 0) legs[key] = routes;
  }
  if (Object.keys(legs).length === 0) return null;

  const layers = body.layers;
  return {
    recordedAt: typeof body.recordedAt === "string" ? body.recordedAt : "",
    sources: {
      routing: body.sources?.routing ?? "",
      overpass: body.sources?.overpass ?? "",
    },
    legs,
    layers: {
      spots: Array.isArray(layers?.spots) ? layers.spots : [],
      lamps: Array.isArray(layers?.lamps) ? layers.lamps : [],
      litWays: Array.isArray(layers?.litWays) ? layers.litWays : [],
      truncated: false,
    },
  };
}
