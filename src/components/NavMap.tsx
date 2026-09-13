"use client";

/**
 * The tilted, heading-up map the navigation view runs on. MapLibre, not Leaflet.
 *
 * Everything else in this app is Leaflet with raster tiles, and that is right
 * for planning: flat, north up, cheap, and the same picture on every machine.
 * A navigation view wants to lean into the direction of travel, and a raster
 * tile cannot be tilted — the labels would tilt with it and become unreadable.
 * Vector tiles and a GPU renderer are what make the difference, which is
 * MapLibre. See `src/lib/vector.ts` for the source and the style rewriting.
 *
 * **It is only ever mounted while navigating**, and only when the style loads.
 * `maplibre-gl` is about a megabyte and its GPU context is not free; the
 * planning map has no use for either. `RoutePlanner` falls back to the flat
 * Leaflet view when `onUnavailable` fires — on the machine that cannot reach
 * the vector host at all, that is the whole difference between a navigation
 * view and a blank rectangle.
 *
 * Nothing here is Leaflet-shaped on purpose: two map libraries in one component
 * tree that both think they own the viewport is a class of bug not worth
 * inviting. They are mounted alternately, never together.
 */

import { useEffect, useRef, useState } from "react";
// The renderer's own stylesheet. Imported here rather than globally so it rides
// in the same dynamic chunk as the library and never reaches the planning page.
import "maplibre-gl/dist/maplibre-gl.css";

import { distanceM } from "@/lib/geo";
import { headingOnPath, pointAt, type Fix } from "@/lib/navigation";
import type { LatLng, Route } from "@/lib/osrm";
import type { Segment } from "@/lib/segments";
import { NAV_PITCH, NAV_ZOOM, VECTOR_STYLE, rewriteStyle, stillReachesOut } from "@/lib/vector";
import { VERDICT_COLOUR } from "@/lib/verdict";

/**
 * How long to wait for the first basemap tile before giving up on it.
 *
 * Long enough for a slow exit in the pool to answer — these tiles come through
 * the same proxies everything else does — and short enough that nobody stands
 * on a corner watching a blank rectangle wondering whether it is loading.
 */
export const BASEMAP_GRACE_MS = 9_000;

export interface NavMapProps {
  route: Route;
  /** The stretches, so the line keeps the safety colouring it has when flat. */
  segments: Segment[];
  me: Fix | null;
  /** Metres walked, for fading what is behind. */
  travelledM: number | null;
  /** Keep the camera on the walker rather than where it was dragged to. */
  follow: boolean;
  onFollowBroken: () => void;
  /** The vector basemap could not be used. Fall back to the flat map. */
  onUnavailable: (why: string) => void;
  night: boolean;
}

/*
 * The little of MapLibre's surface this component actually uses.
 *
 * Written out rather than imported, because importing the real types would pull
 * `maplibre-gl` into the planning bundle at build time — the one thing the
 * dynamic import exists to avoid. Anything added here has to be added
 * deliberately, which is the point.
 */
/**
 * The shape of the events this component listens for.
 *
 * One union rather than a listener type per event: MapLibre's own `on` is
 * overloaded per event name, and reproducing that here would be a lot of
 * surface for three callbacks.
 */
interface MapEvent {
  error?: { message?: string };
  dataType?: string;
  sourceId?: string;
  isSourceLoaded?: boolean;
  tile?: unknown;
}

type Listener = (event: MapEvent) => void;

interface MapHandle {
  on(event: string, listener: Listener | (() => void)): void;
  remove(): void;
  getSource(id: string): { setData(data: unknown): void } | undefined;
  addSource(id: string, source: unknown): void;
  getLayer(id: string): unknown;
  addLayer(layer: unknown): void;
  getZoom(): number;
  getBearing(): number;
  easeTo(options: unknown): void;
  touchZoomRotate?: { disableRotation?: () => void };
}

interface MarkerHandle {
  setLngLat(at: [number, number]): MarkerHandle;
  addTo(map: MapHandle): MarkerHandle;
  remove(): void;
}

interface MapLibreModule {
  Map: new (options: unknown) => MapHandle;
  Marker: new (options: unknown) => MarkerHandle;
}

/** A GeoJSON line from a path, in GeoJSON's own lng,lat order. */
function lineOf(path: readonly LatLng[]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "LineString" as const, coordinates: path.map((p) => [p.lng, p.lat]) },
  };
}

/** The route cut at how far has been walked, so the two halves draw differently. */
function split(path: readonly LatLng[], travelledM: number | null): { done: LatLng[]; ahead: LatLng[] } {
  if (travelledM === null || path.length < 2) return { done: [], ahead: [...path] };
  const cut = pointAt(path, travelledM);
  if (!cut) return { done: [], ahead: [...path] };

  const done: LatLng[] = [];
  const ahead: LatLng[] = [cut];
  let run = 0;
  for (let i = 0; i < path.length; i++) {
    const here = path[i];
    const previous = path[i - 1];
    if (!here) continue;
    if (i > 0 && previous) run += distanceM(previous, here);
    if (run <= travelledM) done.push(here);
    else ahead.push(here);
  }
  done.push(cut);
  return { done, ahead };
}

export default function NavMap({
  route, segments, me, travelledM, follow, onFollowBroken, onUnavailable, night,
}: NavMapProps) {
  const holder = useRef<HTMLDivElement | null>(null);
  /*
   * Deliberately untyped handles.
   *
   * `maplibre-gl` is imported dynamically so the planning page never loads it,
   * and pulling its types in statically here to name these would defeat that at
   * the type level while adding nothing — everything actually touched below is
   * a handful of documented methods.
   */
  const map = useRef<MapHandle | null>(null);
  const marker = useRef<MarkerHandle | null>(null);
  const maplibre = useRef<MapLibreModule | null>(null);
  const [ready, setReady] = useState(false);

  /* ── bring the library and the style up ─────────────────────────────────
     Both are dynamic: the import so the planning page never pays for a
     megabyte it does not use, and the style because it has to be rewritten
     before MapLibre sees it or every tile, glyph and icon goes straight out to
     the upstream and around this server's proxy chain entirely. */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    void (async () => {
      const holderEl = holder.current;
      if (!holderEl) return;

      try {
        const [module, styleReply] = await Promise.all([
          import("maplibre-gl"),
          fetch(VECTOR_STYLE),
        ]);
        const maplibregl = module.default as unknown as MapLibreModule;
        if (cancelled) return;
        if (!styleReply.ok) {
          onUnavailable(`the vector basemap answered ${styleReply.status}`);
          return;
        }

        const style = rewriteStyle(await styleReply.json());
        if (cancelled) return;
        /*
         * Checked, not trusted. A style that still names the upstream host
         * fails INVISIBLY on the machine with working internet and blanks the
         * map on the one that needed the forwarder — so the flat map is a
         * better answer than a tilted one that only works in development.
         */
        if (stillReachesOut(style)) {
          onUnavailable("the vector basemap style would have reached around this server");
          return;
        }

        const instance = new maplibregl.Map({
          container: holderEl,
          style,
          center: [route.path[0]?.lng ?? 0, route.path[0]?.lat ?? 0],
          zoom: NAV_ZOOM,
          pitch: NAV_PITCH,
          // Leaflet's are off for the same reason: top-left is the corner the
          // hand holding the phone cannot reach, and it is under the banner.
          attributionControl: { compact: true },
          // A walker does not need to spin the map by hand, and a stray
          // two-finger twist while it is following is only confusing.
          dragRotate: false,
          pitchWithRotate: false,
          touchZoomRotate: true,
        });
        instance.touchZoomRotate?.disableRotation?.();

        /*
         * ── a basemap that never arrives must not be silent ──────────────
         *
         * This is the failure that shipped. The style loaded, MapLibre started,
         * every tile request failed through the proxy pool — and the handler
         * here logged a warning and carried on, so the view sat there as a
         * blank rectangle with a route drawn on nothing. It looked identical to
         * a map that had simply not painted yet, and there was no way for
         * anyone, including me, to tell from the screen which it was.
         *
         * An individual tile failing is still fine — that is normal through a
         * pool of public proxies and must not tear the map down. What is not
         * fine is NONE of them arriving, so the style's own sources are
         * counted, and if nothing has loaded by the time the grace period is up
         * the flat map takes over and says why.
         *
         * Only the style's sources count. The route lines are `geojson` sources
         * added here; they load instantly and always, so counting them would
         * report a healthy basemap on a screen with no basemap at all.
         */
        /*
         * ⚠ `isSourceLoaded` does NOT mean tiles arrived.
         *
         * For a tiled source it means the source DEFINITION is ready — the
         * TileJSON parsed, or the inline `tiles` array was read — which happens
         * immediately and says nothing about whether a single tile came back.
         * Counting it was the bug in the first version of this watchdog: a
         * style whose tiles could never load reported itself healthy before the
         * first request went out, and the blank map stayed on screen.
         *
         * So it depends on the source's type. A tiled source has only arrived
         * when an actual tile has (`event.tile`). A geojson, image or video
         * source has no tiles and `isSourceLoaded` is the only signal there is.
         */
        const declared = (style as { sources?: Record<string, { type?: string }> }).sources ?? {};
        const tiled = new Set(["vector", "raster", "raster-dem"]);
        const needsTile = new Map(
          Object.entries(declared).map(([id, source]) => [id, tiled.has(source?.type ?? "")]),
        );
        let loaded = 0;

        instance.on("data", (event: MapEvent) => {
          if (event?.dataType !== "source" || !event.sourceId) return;
          const wantsTile = needsTile.get(event.sourceId);
          if (wantsTile === undefined) return;   // one of ours, not the style's
          if (wantsTile ? Boolean(event.tile) : Boolean(event.isSourceLoaded)) loaded += 1;
        });

        instance.on("error", (event: MapEvent) => {
          if (typeof console !== "undefined") console.warn("[nav map]", event?.error?.message ?? event);
        });

        const watchdog = setTimeout(() => {
          if (cancelled || loaded > 0) return;
          onUnavailable(
            needsTile.size === 0
              ? "the vector basemap style has no map in it"
              : "no basemap tiles arrived",
          );
        }, BASEMAP_GRACE_MS);
        timer = watchdog;

        // A drag is the walker taking over. `dragstart` only a person can
        // cause; `move` is fired by our own camera and would fight the finger.
        instance.on("dragstart", () => onFollowBroken());

        instance.on("load", () => {
          if (cancelled) { instance.remove(); return; }
          map.current = instance;
          maplibre.current = maplibregl;
          setReady(true);
        });
      } catch (error) {
        if (!cancelled) {
          onUnavailable(error instanceof Error ? error.message : "the vector basemap could not be loaded");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      marker.current?.remove();
      marker.current = null;
      map.current?.remove();
      map.current = null;
    };
    // Mount once per navigation session. The route cannot change under it —
    // `RoutePlanner` ends the trip when the plan is edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── the route, and how much of it is behind you ────────────────────────── */
  const done = travelledM ?? 0;
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;

    const halves = split(route.path, travelledM);
    const ahead = lineOf(halves.ahead);
    const behind = lineOf(halves.done);

    /*
     * The safety colouring is kept, and that is the point of this app.
     *
     * A navigation map that draws one blue line has thrown away the only thing
     * Maddie knows that a road atlas does not. Each stretch keeps the colour
     * its verdict has everywhere else — `VERDICT_COLOUR`, the same table the
     * flat map reads.
     */
    const stretches = {
      type: "FeatureCollection" as const,
      features: segments.map((segment) => ({
        ...lineOf(segment.path),
        properties: { colour: VERDICT_COLOUR[segment.verdict] },
      })),
    };

    const put = (id: string, data: unknown) => {
      const source = instance.getSource(id);
      if (source) source.setData(data);
      else instance.addSource(id, { type: "geojson", data });
    };

    put("route-ahead", ahead);
    put("route-behind", behind);
    put("route-stretches", stretches);

    if (!instance.getLayer("route-ahead-casing")) {
      instance.addLayer({
        id: "route-ahead-casing", type: "line", source: "route-ahead",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": night ? "#0b0d13" : "#ffffff", "line-width": 14, "line-opacity": 0.9 },
      });
      /*
       * The route ahead, ALWAYS drawn — and this is a bug fixed, not a nicety.
       *
       * It used to be drawn only by the stretch layer below, which is built
       * from the Overpass read. With no read — the request failed, or it has
       * not come back yet, or the map says nothing about these streets — there
       * were no stretches, so the only thing left was the casing: white on a
       * pale basemap, black on a dark one. Invisible. The navigation view drew
       * no route at all and said nothing about it, and I shipped a screenshot
       * of exactly that and read the walked-behind line as the route.
       *
       * So the line exists first, in the app's accent, and the verdict colours
       * are an overlay on top of it when there is something to say.
       */
      instance.addLayer({
        id: "route-ahead-line", type: "line", source: "route-ahead",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": night ? "#8b6dff" : "#5b3df5", "line-width": 8 },
      });
      instance.addLayer({
        id: "route-stretches-line", type: "line", source: "route-stretches",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "colour"], "line-width": 8 },
      });
      // What is behind you is history: drawn last, and dulled.
      instance.addLayer({
        id: "route-behind-line", type: "line", source: "route-behind",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": night ? "#4b5364" : "#aeb6c6", "line-width": 8, "line-opacity": 0.9 },
      });
    }
  }, [ready, route, segments, travelledM, night, done]);

  /* ── where the device says you are ──────────────────────────────────────
     A DOM marker rather than a circle layer: a layer is drawn in map space, so
     under a 55° pitch the dot squashes into an ellipse and shrinks with
     distance. The marker stays the size it is meant to be. */
  useEffect(() => {
    const instance = map.current;
    const maplibregl = maplibre.current;
    if (!ready || !instance || !maplibregl) return;
    if (!me) { marker.current?.remove(); marker.current = null; return; }

    if (!marker.current) {
      const dot = document.createElement("div");
      dot.className = "navmap-me";
      marker.current = new maplibregl.Marker({ element: dot }).setLngLat([me.point.lng, me.point.lat]).addTo(instance);
    } else {
      marker.current.setLngLat([me.point.lng, me.point.lat]);
    }
  }, [ready, me]);

  /* ── the camera follows, and leans into the next turn ───────────────────── */
  const lat = me?.point.lat;
  const lng = me?.point.lng;
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || !follow || lat === undefined || lng === undefined) return;

    /*
     * The heading comes from the ROUTE, not the device compass — see
     * `headingOnPath`. A phone's heading is absent or wild standing still,
     * which is exactly when somebody is looking at the screen.
     */
    const bearing = travelledM === null ? null : headingOnPath(route.path, travelledM);

    /*
     * The live camera, reflected onto the element.
     *
     * Not decoration and not only for tests: "the map is not turning" is a
     * report that arrives with no way to tell whether the bearing is wrong, the
     * position is stale, or the tilt never applied. Two attributes make the
     * camera readable from the outside — in a screenshot of the inspector, in a
     * browser test, in the field.
     */
    const holderEl = holder.current;
    if (holderEl) {
      holderEl.dataset.bearing = String(Math.round(bearing ?? instance.getBearing()));
      holderEl.dataset.pitch = String(NAV_PITCH);
    }

    instance.easeTo({
      center: [lng, lat],
      bearing: bearing ?? instance.getBearing(),
      pitch: NAV_PITCH,
      zoom: Math.max(instance.getZoom(), NAV_ZOOM),
      duration: 700,
      // The walker sits low on the screen so most of it is the road ahead,
      // which is the whole reason for tilting in the first place.
      padding: { top: Math.round((holder.current?.clientHeight ?? 600) * 0.35), bottom: 0, left: 0, right: 0 },
    });
  }, [ready, follow, lat, lng, travelledM, route]);

  return (
    <div className="navmap" ref={holder} aria-label="Navigation map">
      {!ready && <div className="map-loading">Bringing up the navigation map…</div>}
    </div>
  );
}
