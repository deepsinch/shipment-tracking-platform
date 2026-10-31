"use client";

// MapLibre's own styles (controls, markers, popups, attribution). Imported here, in the module
// only the map components load, so the stylesheet ships with the map chunk instead of every page.
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";

import {
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type LngLatBoundsLike,
  type PaddingOptions,
  type Marker,
} from "maplibre-gl";
import { useEffect, useEffectEvent, useState, type RefObject } from "react";

import { easeOutCubic, interpolateLatLng, type LatLng } from "@/lib/geo";

import { FIT_MAX_ZOOM, MAP_STYLE_URL, MARKER_EASE_MS } from "./map-config";

/**
 * MapLibre 6 decodes tiles in a web worker loaded from a separate file it looks for next to its own
 * module. Bundled, its module is a chunk in `/_next/static`, where that file does not exist, so we
 * point it at the copy the bundler emits for this `new URL(..., import.meta.url)` reference.
 */
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);

export type { MapLibreMap };

/** Clear of the markers' size, and of the zoom buttons in the top-right corner. */
const DEFAULT_PADDING: PaddingOptions = { top: 48, bottom: 48, left: 48, right: 72 };

type MapState = { map: MapLibreMap | null; failed: boolean };

/**
 * Creates a MapLibre map in `container` and removes it again when the component unmounts or Next
 * hides the route (Activity runs effect cleanups when it hides a page, and runs the effect again
 * when it shows it). Removing it matters: each map holds a WebGL context, browsers allow only a
 * handful, and a hidden page would otherwise keep its map (and its tile worker) alive.
 *
 * `bounds` is read once per creation: the map then belongs to the user, who may have panned.
 * Returns `failed` when the browser cannot create a map (no WebGL), so the page can say so; the
 * text beside every map carries the same information.
 */
export function useMapLibreMap(
  container: RefObject<HTMLElement | null>,
  options: {
    /** The map's accessible name (MapLibre gives its canvas `role="region"`). */
    label: string;
    bounds: LngLatBoundsLike;
    /** Space kept around the fitted bounds, for labels beside markers and the zoom buttons. */
    padding?: PaddingOptions;
    cooperativeGestures?: boolean;
  },
): MapState {
  const [state, setState] = useState<MapState>({ map: null, failed: false });
  const { label, cooperativeGestures = false } = options;
  const initialView = useEffectEvent(() => ({
    bounds: options.bounds,
    padding: options.padding ?? DEFAULT_PADDING,
  }));

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    const map = createMap(element, { ...initialView(), label, cooperativeGestures });
    // The map is an external object created by this effect; marker effects need the instance,
    // so it is handed to React here (and taken back in the cleanup).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ map, failed: map === null });
    if (!map) return;

    return () => {
      setState({ map: null, failed: false });
      map.remove();
    };
  }, [container, label, cooperativeGestures]);

  return state;
}

function createMap(
  container: HTMLElement,
  options: {
    bounds: LngLatBoundsLike;
    padding: PaddingOptions;
    label: string;
    cooperativeGestures: boolean;
  },
): MapLibreMap | null {
  let map: MapLibreMap;
  try {
    map = new MapLibreMap({
      container,
      style: MAP_STYLE_URL,
      bounds: options.bounds,
      fitBoundsOptions: { padding: options.padding, maxZoom: FIT_MAX_ZOOM },
      // OpenStreetMap's licence asks for visible attribution: keep it expanded at every width.
      attributionControl: { compact: false },
      // A dispatch map is read north-up; rotation and tilt only get in the way.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      cooperativeGestures: options.cooperativeGestures,
      locale: { "Map.Title": options.label },
    });
  } catch (error) {
    // No WebGL (an old browser, a locked-down machine): the page's text still says it all.
    console.error("The map could not be created", error);
    return null;
  }
  map.touchZoomRotate.disableRotation();
  map.addControl(new NavigationControl({ showCompass: false }), "top-right");
  return map;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const glides = new WeakMap<Marker, number>();

/**
 * Moves a marker to `to`: a short ease when it is already on the map, a jump for a new marker or
 * when the user prefers reduced motion. A new glide replaces one still running. `onFrame` sees each
 * intermediate position (to keep an open popup on the marker).
 */
export function glideMarker(
  marker: Marker,
  to: LatLng,
  { animate, onFrame }: { animate: boolean; onFrame?: (position: LatLng) => void },
): void {
  cancelGlide(marker);
  const start = marker.getLngLat();
  const from = { lat: start.lat, lng: start.lng };
  if (!animate || prefersReducedMotion() || (from.lat === to.lat && from.lng === to.lng)) {
    marker.setLngLat([to.lng, to.lat]);
    onFrame?.(to);
    return;
  }

  const startedAt = performance.now();
  const step = (time: number) => {
    const progress = (time - startedAt) / MARKER_EASE_MS;
    const position = interpolateLatLng(from, to, easeOutCubic(progress));
    marker.setLngLat([position.lng, position.lat]);
    onFrame?.(position);
    if (progress < 1) glides.set(marker, requestAnimationFrame(step));
    else glides.delete(marker);
  };
  glides.set(marker, requestAnimationFrame(step));
}

export function cancelGlide(marker: Marker): void {
  const frame = glides.get(marker);
  if (frame !== undefined) cancelAnimationFrame(frame);
  glides.delete(marker);
}
