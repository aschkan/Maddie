/**
 * The areas the evidence dashboard can show — a city, and the districts in it.
 *
 * READ THIS BEFORE TRUSTING A NUMBER IN HERE.
 *
 * The dashboard (`docs/Maddie-Evidence-Dashboard.md`) needs three things per
 * district that no live source hands back in one piece:
 *
 *   * an OUTLINE, to draw the selected area and to put each report in a
 *     district (point-in-polygon, `evidence.ts`);
 *   * the LIGHTING composition of its street network — lit / unlit / unknown
 *     by length — for the stacked bar;
 *   * the length of its ROAD NETWORK, so the area view can show reports per km
 *     rather than raw counts, and a big district is not "worse" for being big.
 *
 * The outlines are hand-traced approximations of the municipal districts
 * (stadsdelen / wijken), good to a street or two — enough to draw and to bin
 * a report, not a cadastral boundary. The lighting and road figures are
 * EXAMPLE values, shaped like what OpenStreetMap holds for these cities and
 * calibrated against nothing. That is why every number from here carries
 * `source: "example"`, why the provenance table says so, and why the board's
 * subtitle reads "Synthetic example data" whenever any of it is on screen.
 *
 * Replacing them with real figures is a data job, not a code change: compute
 * the lit/unlit/unknown length per district from Overpass (`lit=*` on
 * `way[highway]`, clipped to the outline) and set `source: "osm"`. Nothing
 * downstream branches on the numbers — only on `source`, for the wording.
 */

import type { LatLng } from "./osrm.ts";

export type FigureSource = "example" | "osm";

export interface LightingShare {
  /** Percent of street length, each 0–100. They need not sum to exactly 100. */
  lit: number;
  unlit: number;
  unknown: number;
}

export interface District {
  id: string;
  name: string;
  /** Where the uppercase label sits on the map. */
  label: LatLng;
  /** One closed ring, [lat, lng]. Not repeated at the end. */
  outline: LatLng[];
  lighting: LightingShare;
  /** Kilometres of road network, for "reports per km". */
  roadKm: number;
  /** Nearby places in the area, for the provenance row. */
  places: number;
}

export interface TripEnd {
  label: string;
  point: LatLng;
}

export interface City {
  id: string;
  name: string;
  centre: LatLng;
  zoom: number;
  districts: District[];
  /** Where the lighting / road figures above came from. */
  figures: FigureSource;
  /**
   * The trip the Compare board opens on, so it is never an empty page.
   * Utrecht's is the study scenario's own, which is RECORDED and so works with
   * no network at all — see `scenario.ts`.
   */
  trip: { from: TripEnd; to: TripEnd };
  /** Is the study scenario recorded for this city? Only Utrecht's is. */
  scenario: boolean;
  /**
   * A walk through the middle of the city, for the "distance from report to
   * route" histogram before anybody has planned one. Labelled as the example
   * route wherever it is used.
   */
  exampleRoute: LatLng[];
}

const p = (lat: number, lng: number): LatLng => ({ lat, lng });

export const CITIES: City[] = [
  {
    id: "amsterdam",
    name: "Amsterdam",
    centre: p(52.3668, 4.9005),
    zoom: 13,
    figures: "example",
    scenario: false,
    trip: {
      from: { label: "Amsterdam Centraal", point: p(52.37875, 4.90005) },
      to: { label: "Oosterpark", point: p(52.35965, 4.91900) },
    },
    exampleRoute: [
      p(52.3787, 4.9001), p(52.3760, 4.8990), p(52.3727, 4.8935), p(52.3690, 4.8930),
      p(52.3668, 4.8975), p(52.3650, 4.9030), p(52.3630, 4.9090), p(52.3612, 4.9150),
      p(52.3598, 4.9190),
    ],
    districts: [
      {
        id: "centrum", name: "Centrum", label: p(52.3735, 4.9000),
        outline: [
          p(52.3868, 4.8885), p(52.3800, 4.8800), p(52.3740, 4.8800), p(52.3665, 4.8820),
          p(52.3620, 4.8870), p(52.3590, 4.8960), p(52.3595, 4.9050), p(52.3620, 4.9120),
          p(52.3650, 4.9200), p(52.3700, 4.9250), p(52.3745, 4.9210), p(52.3790, 4.9080),
          p(52.3800, 4.8990), p(52.3840, 4.8930),
        ],
        lighting: { lit: 62, unlit: 28, unknown: 10 }, roadKm: 12.1, places: 31,
      },
      {
        id: "west", name: "West", label: p(52.3790, 4.8620),
        outline: [
          p(52.3920, 4.8500), p(52.3930, 4.8800), p(52.3868, 4.8885), p(52.3800, 4.8800),
          p(52.3740, 4.8800), p(52.3665, 4.8820), p(52.3630, 4.8620), p(52.3700, 4.8450),
          p(52.3820, 4.8420),
        ],
        lighting: { lit: 48, unlit: 42, unknown: 10 }, roadKm: 9.6, places: 18,
      },
      {
        id: "oost", name: "Oost", label: p(52.3630, 4.9400),
        outline: [
          p(52.3745, 4.9210), p(52.3700, 4.9250), p(52.3650, 4.9200), p(52.3620, 4.9120),
          p(52.3560, 4.9150), p(52.3480, 4.9300), p(52.3500, 4.9550), p(52.3620, 4.9650),
          p(52.3720, 4.9500), p(52.3760, 4.9350),
        ],
        lighting: { lit: 55, unlit: 33, unknown: 12 }, roadKm: 8.9, places: 14,
      },
      {
        id: "zuid", name: "Zuid", label: p(52.3490, 4.8800),
        outline: [
          p(52.3620, 4.8870), p(52.3590, 4.8960), p(52.3595, 4.9050), p(52.3560, 4.9150),
          p(52.3480, 4.9150), p(52.3380, 4.9050), p(52.3360, 4.8750), p(52.3420, 4.8550),
          p(52.3560, 4.8580), p(52.3630, 4.8620), p(52.3665, 4.8820),
        ],
        lighting: { lit: 70, unlit: 20, unknown: 10 }, roadKm: 7.4, places: 12,
      },
    ],
  },
  {
    id: "utrecht",
    name: "Utrecht",
    centre: p(52.0920, 5.1250),
    zoom: 13,
    figures: "example",
    scenario: true,
    trip: {
      from: { label: "Utrecht Centraal", point: p(52.08938, 5.1096) },
      to: { label: "Utrecht Science Park", point: p(52.08541, 5.17584) },
    },
    exampleRoute: [
      p(52.0894, 5.1096), p(52.0915, 5.1150), p(52.0912, 5.1215), p(52.0930, 5.1265),
      p(52.0950, 5.1300), p(52.0950, 5.1390), p(52.0920, 5.1500), p(52.0880, 5.1620),
      p(52.0854, 5.1758),
    ],
    districts: [
      {
        id: "binnenstad", name: "Binnenstad", label: p(52.0915, 5.1180),
        outline: [
          p(52.0985, 5.1135), p(52.0980, 5.1230), p(52.0955, 5.1300), p(52.0905, 5.1310),
          p(52.0860, 5.1260), p(52.0850, 5.1170), p(52.0865, 5.1050), p(52.0905, 5.1040),
          p(52.0950, 5.1075),
        ],
        lighting: { lit: 62, unlit: 28, unknown: 10 }, roadKm: 5.0, places: 31,
      },
      {
        id: "west", name: "West", label: p(52.0905, 5.0890),
        outline: [
          p(52.0950, 5.1075), p(52.0905, 5.1040), p(52.0865, 5.1050), p(52.0820, 5.1000),
          p(52.0790, 5.0850), p(52.0880, 5.0750), p(52.0980, 5.0800), p(52.1010, 5.0950),
        ],
        lighting: { lit: 48, unlit: 42, unknown: 10 }, roadKm: 7.9, places: 16,
      },
      {
        id: "oost", name: "Oost", label: p(52.0860, 5.1540),
        outline: [
          p(52.0955, 5.1300), p(52.0905, 5.1310), p(52.0860, 5.1260), p(52.0780, 5.1350),
          p(52.0760, 5.1600), p(52.0800, 5.1850), p(52.0900, 5.1850), p(52.0960, 5.1550),
          p(52.0975, 5.1380),
        ],
        lighting: { lit: 55, unlit: 33, unknown: 12 }, roadKm: 7.0, places: 19,
      },
      {
        id: "noordoost", name: "Noordoost", label: p(52.1010, 5.1350),
        outline: [
          p(52.0985, 5.1135), p(52.0980, 5.1230), p(52.0955, 5.1300), p(52.0975, 5.1380),
          p(52.0960, 5.1550), p(52.1060, 5.1500), p(52.1080, 5.1300), p(52.1040, 5.1150),
        ],
        lighting: { lit: 70, unlit: 20, unknown: 10 }, roadKm: 6.4, places: 11,
      },
    ],
  },
];

export const DEFAULT_CITY = "amsterdam";

export function cityById(id: string | null | undefined): City {
  return CITIES.find((city) => city.id === id) ?? CITIES.find((city) => city.id === DEFAULT_CITY)!;
}

export function districtById(city: City, id: string | null | undefined): District | null {
  return city.districts.find((district) => district.id === id) ?? null;
}
