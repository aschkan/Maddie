"use client";

/**
 * The device's position, while a walk is being navigated.
 *
 * Thin on purpose: it owns the browser API and nothing else. Everything that
 * turns a position into "turn left in 40 m" is in `src/lib/navigation.ts`,
 * pure and tested, because those are judgements about somebody walking down a
 * street at night and they have to be checkable without going outside.
 *
 * Three things here are not obvious and all three are deliberate.
 *
 * **The watch only runs while navigating.** `watchPosition` keeps the GPS warm,
 * which on a phone is the difference between a walk and a flat battery. It is
 * started when the trip starts and cleared the moment it ends.
 *
 * **A refused permission is a state, not an exception.** On a page about
 * walking home after dark, "I would rather not share my location" is a
 * perfectly reasonable answer, and the navigation still works as a map you
 * follow by eye. So the error is carried and shown, and nothing throws.
 *
 * **A wildly inaccurate fix is kept, and labelled.** Dropping fixes above some
 * accuracy threshold is the tempting move; it fails badly indoors and in the
 * narrow streets this app is most for, where every fix is poor and dropping
 * them all leaves the screen frozen with no explanation. The accuracy comes
 * through instead, and the view says when it is bad.
 */

import { useEffect, useState } from "react";

import type { Fix } from "@/lib/navigation";

export interface Located {
  /** The last position, or null before the first one arrives. */
  fix: Fix | null;
  /** Why there is no position, in words for the person. Null when fine. */
  error: string | null;
  /** True between asking and the first answer. */
  waiting: boolean;
}

const IDLE: Located = { fix: null, error: null, waiting: false };

/** What each `GeolocationPositionError` means to somebody trying to walk. */
function explain(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "This page cannot see your location, so the map will not follow you. " +
        "The route and the turns are still here — allow location in your browser's site settings to have it follow.";
    case error.POSITION_UNAVAILABLE:
      return "Your device could not get a position. Indoors and between tall buildings that is normal; it usually comes back outside.";
    case error.TIMEOUT:
      return "Waiting for a position took too long. Still trying.";
    default:
      return "Your location is not available just now.";
  }
}

/**
 * Watch the device's position while `active`.
 *
 * `enableHighAccuracy` is on because the whole point is which side of a street
 * you are on, and the coarse network fix cannot answer that. It costs battery,
 * which is the trade a navigation view is asking for anyway.
 */
export function useNavigation(active: boolean): Located {
  const [state, setState] = useState<Located>(IDLE);

  useEffect(() => {
    /*
     * All of it inside the async body, including the resets.
     *
     * The React Compiler lint rejects a `setState` reached synchronously from
     * an effect body — see CLAUDE.md. `cancelled` is what keeps that safe: the
     * cleanup can run before the body gets as far as registering the watch, and
     * without the check that registration would happen afterwards and never be
     * cleared, leaving the GPS on after the walk ended.
     */
    let cancelled = false;
    let id: number | null = null;

    void (async () => {
      if (cancelled) return;

      if (!active) {
        setState(IDLE);
        return;
      }
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        setState({
          fix: null,
          waiting: false,
          error: "This browser cannot report a location, so the map will not follow you.",
        });
        return;
      }

      setState({ fix: null, error: null, waiting: true });
      if (cancelled) return;

      id = navigator.geolocation.watchPosition(
        (position) => {
          setState({
            fix: {
              point: { lat: position.coords.latitude, lng: position.coords.longitude },
              accuracyM: position.coords.accuracy,
            },
            error: null,
            waiting: false,
          });
        },
        (error) => {
          /*
           * Keep the last position.
           *
           * A timeout while already following is a blip, not a reason to throw
           * away where the walker was — the map would jump back to the route
           * and they would think they had gone wrong.
           */
          setState((previous) => ({
            fix: previous.fix,
            error: explain(error),
            waiting: false,
          }));
        },
        {
          enableHighAccuracy: true,
          // A fix older than this is not where you are any more, at walking pace.
          maximumAge: 5_000,
          timeout: 20_000,
        },
      );
    })();

    return () => {
      cancelled = true;
      if (id !== null) navigator.geolocation.clearWatch(id);
    };
  }, [active]);

  return state;
}
