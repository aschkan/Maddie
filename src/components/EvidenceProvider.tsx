"use client";

/**
 * What the boards share: the city, the theme, the reports, and the route the
 * Compare board last had selected.
 *
 * It wraps every page from `layout.tsx`, so moving between Explore, Compare and
 * an area keeps the same city and the same route — the route you picked on
 * Compare is the one Explore's "distance from report to route" measures.
 *
 * The REPORTS are the real ones for the chosen city (`useReports`): Pointer's
 * survey, the study team's additions and community reports, asked of the
 * database by a circle round the city centre. There is no example data —
 * the generator that used to fill the boards in the browser is gone.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useReports, type Backend, type Dataset } from "@/components/useReports";
import { CITIES, cityById, DEFAULT_CITY, type City } from "@/lib/cities";
import type { LatLng } from "@/lib/osrm";
import type { Tone } from "@/lib/palette";
import type { Report } from "@/lib/reports";

const CITY_KEY = "maddie.city.v1";
const THEME_KEY = "maddie.theme.v1";

/** A report belongs to a city if it is within this of the centre. */
const CITY_RADIUS_M = 9_000;

export interface ChosenRoute {
  cityId: string;
  label: string;
  path: LatLng[];
}

interface Evidence {
  city: City;
  cities: City[];
  setCity: (id: string) => void;
  tone: Tone;
  toggleTheme: () => void;
  /** Every report within `CITY_RADIUS_M` of this city's centre. */
  reports: Report[];
  /** Where they came from — printed under the boards (Pointer must be credited). */
  datasets: Dataset[];
  backend: Backend;
  reportError: string | null;
  reportsLoading: boolean;
  addReport: (report: Report) => void;
  route: ChosenRoute | null;
  setRoute: (route: ChosenRoute | null) => void;
}

const Context = createContext<Evidence | null>(null);

export function useEvidence(): Evidence {
  const value = useContext(Context);
  if (!value) throw new Error("useEvidence outside <EvidenceProvider>");
  return value;
}

export default function EvidenceProvider({ children }: { children: ReactNode }) {
  const [cityId, setCityId] = useState(DEFAULT_CITY);
  const [tone, setTone] = useState<Tone>("day");
  const [route, setRoute] = useState<ChosenRoute | null>(null);
  const city = cityById(cityId);
  const store = useReports(city.centre, CITY_RADIUS_M);

  // Read on mount, in the IIFE every setState in this app lives in: the page
  // is prerendered, and localStorage does not exist during that render.
  useEffect(() => {
    void (async () => {
      try {
        const saved = window.localStorage.getItem(CITY_KEY);
        if (saved && CITIES.some((city) => city.id === saved)) setCityId(saved);
        setTone(document.documentElement.dataset.theme === "dark" ? "night" : "day");
      } catch {
        // A browser that stores nothing still gets the default city.
      }
    })();
  }, []);

  const setCity = useCallback((id: string) => {
    setCityId(id);
    setRoute(null);
    try {
      window.localStorage.setItem(CITY_KEY, id);
    } catch {
      // Nothing to remember it in.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTone((current) => {
      const next: Tone = current === "night" ? "day" : "night";
      document.documentElement.dataset.theme = next === "night" ? "dark" : "light";
      try {
        window.localStorage.setItem(THEME_KEY, next === "night" ? "dark" : "light");
      } catch {
        // The theme still applies to this visit.
      }
      return next;
    });
  }, []);

  const value = useMemo<Evidence>(() => ({
    city,
    cities: CITIES,
    setCity,
    tone,
    toggleTheme,
    reports: store.reports,
    datasets: store.datasets,
    backend: store.backend,
    reportError: store.error,
    reportsLoading: store.loading,
    addReport: store.add,
    route: route && route.cityId === city.id ? route : null,
    setRoute,
  }), [city, setCity, tone, toggleTheme, store.reports, store.datasets, store.backend, store.error, store.loading, store.add, route]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
