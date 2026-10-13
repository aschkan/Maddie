"use client";

/**
 * What the boards share: the city, the theme, the reports, and the route the
 * Compare board last had selected.
 *
 * It wraps every page from `layout.tsx`, so moving between Explore, Compare and
 * an area keeps the same city and the same route — the route you picked on
 * Compare is the one Explore's "distance from report to route" measures.
 *
 * The REPORTS are two things kept visibly apart:
 *
 *   * what is stored (`useReports` — the database, or this browser), filed by
 *     people, `source: "community"`;
 *   * the EXAMPLE reports (`example-reports.ts`), generated here, never stored,
 *     `source: "example"`. On by default so the boards have something to show
 *     before fieldwork exists, and the board's subtitle says "Synthetic example
 *     data" the whole time they are.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useReports, type Backend } from "@/components/useReports";
import { CITIES, cityById, DEFAULT_CITY, type City } from "@/lib/cities";
import { exampleReports } from "@/lib/example-reports";
import { distanceM } from "@/lib/geo";
import type { LatLng } from "@/lib/osrm";
import type { Tone } from "@/lib/palette";
import type { Report } from "@/lib/reports";

const CITY_KEY = "maddie.city.v1";
const THEME_KEY = "maddie.theme.v1";

/** A stored report belongs to a city if it is within this of the centre. */
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
  /** Stored + (if on) example reports for this city. */
  reports: Report[];
  storedCount: number;
  backend: Backend;
  reportError: string | null;
  addReport: (report: Report) => void;
  showExamples: boolean;
  setShowExamples: (on: boolean) => void;
  /** True whenever anything on screen is invented. Drives the subtitle. */
  usingExamples: boolean;
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
  const [showExamples, setShowExamples] = useState(true);
  const [route, setRoute] = useState<ChosenRoute | null>(null);
  const store = useReports();

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

  const city = cityById(cityId);
  const examples = useMemo(() => exampleReports(city), [city]);
  const stored = useMemo(
    () => store.reports.filter((report) => distanceM(report.point, city.centre) <= CITY_RADIUS_M),
    [store.reports, city],
  );
  const reports = useMemo(
    () => (showExamples ? [...stored, ...examples] : stored),
    [showExamples, stored, examples],
  );

  const value = useMemo<Evidence>(() => ({
    city,
    cities: CITIES,
    setCity,
    tone,
    toggleTheme,
    reports,
    storedCount: stored.length,
    backend: store.backend,
    reportError: store.error,
    addReport: store.add,
    showExamples,
    setShowExamples,
    usingExamples: showExamples || stored.some((report) => report.source === "example"),
    route: route && route.cityId === city.id ? route : null,
    setRoute,
  }), [city, setCity, tone, toggleTheme, reports, stored, store.backend, store.error, store.add, showExamples, route]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
