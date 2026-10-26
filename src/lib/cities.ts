/**
 * The areas the evidence dashboard can show — a city, and the districts in it.
 *
 * Per district the boards need three things no live source hands back in one
 * piece:
 *
 *   * an OUTLINE, to draw the selected area and to put each marked place in a
 *     district (point-in-polygon, `evidence.ts`). Hand-traced approximations
 *     of the municipal districts (stadsdelen / wijken), good to a street or
 *     two — enough to draw and to bin, not a cadastral boundary;
 *   * the LIGHTING composition of its street network — lit / unlit / unknown
 *     by length;
 *   * the length of its ROAD NETWORK, so the area view can show marked places
 *     per km rather than raw counts.
 *
 * The last two (and the count of nearby places) are MEASURED from
 * OpenStreetMap by `scripts/district-figures.ts` into `district-figures.ts`.
 * There used to be invented example values here; they are gone. A district the
 * script has not measured yet reads as 100% unknown with `figures: "missing"`,
 * and the boards say so — never a made-up number.
 */

import { DISTRICT_FIGURES } from "./district-figures.ts";
import type { LatLng } from "./osrm.ts";

export type FigureSource = "osm" | "missing";

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
  /** Whether the lighting / road figures were measured (see the header). */
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
   * route" histogram before anybody has planned one. Labelled as the default
   * walk wherever it is used.
   */
  exampleRoute: LatLng[];
}

const p = (lat: number, lng: number): LatLng => ({ lat, lng });

type DistrictShape = Omit<District, "lighting" | "roadKm" | "places">;
type CityShape = Omit<City, "districts" | "figures"> & { districts: DistrictShape[] };

/** The measured figures joined onto the outlines; unmeasured → all unknown. */
function measured(city: CityShape): City {
  const figures = DISTRICT_FIGURES[city.id] ?? {};
  const all = city.districts.every((d) => figures[d.id]);
  return {
    ...city,
    figures: all ? "osm" : "missing",
    districts: city.districts.map((d) => ({
      ...d,
      ...(figures[d.id] ?? { lighting: { lit: 0, unlit: 0, unknown: 100 }, roadKm: 0, places: 0 }),
    })),
  };
}

const SHAPES: CityShape[] = [
  {
    id: "amsterdam",
    name: "Amsterdam",
    centre: p(52.3668, 4.9005),
    zoom: 13,
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
      },
      {
        id: "west", name: "West", label: p(52.3790, 4.8620),
        outline: [
          p(52.3920, 4.8500), p(52.3930, 4.8800), p(52.3868, 4.8885), p(52.3800, 4.8800),
          p(52.3740, 4.8800), p(52.3665, 4.8820), p(52.3630, 4.8620), p(52.3700, 4.8450),
          p(52.3820, 4.8420),
        ],
      },
      {
        id: "oost", name: "Oost", label: p(52.3630, 4.9400),
        outline: [
          p(52.3745, 4.9210), p(52.3700, 4.9250), p(52.3650, 4.9200), p(52.3620, 4.9120),
          p(52.3560, 4.9150), p(52.3480, 4.9300), p(52.3500, 4.9550), p(52.3620, 4.9650),
          p(52.3720, 4.9500), p(52.3760, 4.9350),
        ],
      },
      {
        id: "zuid", name: "Zuid", label: p(52.3490, 4.8800),
        outline: [
          p(52.3620, 4.8870), p(52.3590, 4.8960), p(52.3595, 4.9050), p(52.3560, 4.9150),
          p(52.3480, 4.9150), p(52.3380, 4.9050), p(52.3360, 4.8750), p(52.3420, 4.8550),
          p(52.3560, 4.8580), p(52.3630, 4.8620), p(52.3665, 4.8820),
        ],
      },
    ],
  },
  {
    id: "utrecht",
    name: "Utrecht",
    centre: p(52.0920, 5.1250),
    zoom: 13,
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
      },
      {
        id: "west", name: "West", label: p(52.0905, 5.0890),
        outline: [
          p(52.0950, 5.1075), p(52.0905, 5.1040), p(52.0865, 5.1050), p(52.0820, 5.1000),
          p(52.0790, 5.0850), p(52.0880, 5.0750), p(52.0980, 5.0800), p(52.1010, 5.0950),
        ],
      },
      {
        id: "oost", name: "Oost", label: p(52.0860, 5.1540),
        outline: [
          p(52.0955, 5.1300), p(52.0905, 5.1310), p(52.0860, 5.1260), p(52.0780, 5.1350),
          p(52.0760, 5.1600), p(52.0800, 5.1850), p(52.0900, 5.1850), p(52.0960, 5.1550),
          p(52.0975, 5.1380),
        ],
      },
      {
        id: "noordoost", name: "Noordoost", label: p(52.1010, 5.1350),
        outline: [
          p(52.0985, 5.1135), p(52.0980, 5.1230), p(52.0955, 5.1300), p(52.0975, 5.1380),
          p(52.0960, 5.1550), p(52.1060, 5.1500), p(52.1080, 5.1300), p(52.1040, 5.1150),
        ],
      },
    ],
  },
];

export const CITIES: City[] = SHAPES.map(measured);

export const DEFAULT_CITY = "amsterdam";

export function cityById(id: string | null | undefined): City {
  return CITIES.find((city) => city.id === id) ?? CITIES.find((city) => city.id === DEFAULT_CITY)!;
}

export function districtById(city: City, id: string | null | undefined): District | null {
  return city.districts.find((district) => district.id === id) ?? null;
}
