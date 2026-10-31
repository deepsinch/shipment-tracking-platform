"use client";

import { Marker, type GeoJSONSource } from "maplibre-gl";
import { useEffect, useRef } from "react";

import type { ShipmentStatus } from "@/domain/shipment-status";
import { boundsOf, WESTERN_EUROPE, type LatLng, type RouteLine } from "@/lib/geo";
import type { Fix } from "@/lib/live-positions";

import { cancelGlide, glideMarker, useMapLibreMap, type MapLibreMap } from "./maplibre";
import { MapUnavailable } from "./map-frame";
import {
  createShipmentMarkerElement,
  createStopMarkerElement,
  updateShipmentMarkerElement,
} from "./marker-elements";

export type Stop = LatLng & { city: string };

export type RouteMapCanvasProps = {
  shipment: {
    shipmentId: string;
    trackingCode: string;
    status: ShipmentStatus;
    destinationCity: string;
  };
  origin: Stop | null;
  destination: Stop | null;
  /** The route to draw: solid along real roads, dashed when it is only a straight line. */
  route: RouteLine | null;
  /** The latest position, kept live by the caller; null hides the marker. */
  position: Fix | null;
};

const ROUTE_SOURCE = "route";

/**
 * The detail page's small map: pickup and delivery pins, the route between them, and the latest
 * position as a status-coloured marker that glides to each new fix. Browser-only, loaded through
 * `next/dynamic` by `RouteMap`.
 *
 * It sits in a scrolling page, so it uses cooperative gestures: one finger (or a plain scroll
 * wheel) scrolls the page instead of getting stuck panning the map.
 */
export default function RouteMapCanvas({
  shipment,
  origin,
  destination,
  route,
  position,
}: RouteMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const points = [origin, destination, position].filter((point) => point !== null);
  const { map, failed } = useMapLibreMap(containerRef, {
    label: `Route map for ${shipment.trackingCode}`,
    bounds: boundsOf(points) ?? WESTERN_EUROPE,
    // City names sit to the right of the pins, and the zoom buttons top right.
    padding: { top: 40, bottom: 36, left: 32, right: 112 },
    cooperativeGestures: true,
  });
  const positionMarker = useRef<Marker | null>(null);

  // Pickup and delivery pins. Dot centred on the coordinate, city name to its right.
  useEffect(() => {
    if (!map) return;
    const stops = [
      origin && stopMarker("pickup", origin).addTo(map),
      destination && stopMarker("delivery", destination).addTo(map),
    ];
    return () => {
      for (const marker of stops) marker?.remove();
    };
  }, [map, origin, destination]);

  // The route line, drawn once the style is ready and replaced when the route changes.
  useEffect(() => {
    if (!map || !route) return;
    const draw = () => showRoute(map, route);
    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
    return () => {
      map.off("load", draw);
    };
  }, [map, route]);

  // The latest position: created on the first fix, then glides to each new one.
  useEffect(() => {
    if (!map) return;
    const existing = positionMarker.current;
    if (!position) {
      if (existing) {
        cancelGlide(existing);
        existing.remove();
        positionMarker.current = null;
      }
      return;
    }
    let marker = existing;
    if (!marker) {
      marker = new Marker({
        element: createShipmentMarkerElement(false),
        subpixelPositioning: true,
      })
        .setLngLat([position.lng, position.lat])
        .addTo(map);
      positionMarker.current = marker;
    }
    updateShipmentMarkerElement(marker.getElement(), shipment, position);
    glideMarker(marker, position, { animate: marker === existing });
  }, [map, position, shipment]);

  // The position marker goes with the map.
  useEffect(() => {
    if (!map) return;
    return () => {
      const marker = positionMarker.current;
      if (marker) {
        cancelGlide(marker);
        marker.remove();
      }
      positionMarker.current = null;
    };
  }, [map]);

  return (
    <>
      {/* Sized by the frame; MapLibre makes this element `position: relative`. */}
      <div ref={containerRef} className="size-full" />
      {failed && <MapUnavailable />}
    </>
  );
}

function stopMarker(kind: "pickup" | "delivery", stop: Stop): Marker {
  // Anchored at the element's left edge, then shifted by half the 14 px dot.
  return new Marker({
    element: createStopMarkerElement(kind, stop.city),
    anchor: "left",
    offset: [-7, 0],
  }).setLngLat([stop.lng, stop.lat]);
}

const ROUTE_LAYER = "route-line";

function showRoute(map: MapLibreMap, route: RouteLine): void {
  const data = { type: "Feature" as const, properties: {}, geometry: route.line };
  // Dashed for a straight line: it is where the shipment is going, not the road it takes.
  const dash = route.kind === "straight" ? [1, 2] : undefined;
  const source = map.getSource<GeoJSONSource>(ROUTE_SOURCE);
  if (source) {
    source.setData(data);
    map.setPaintProperty(ROUTE_LAYER, "line-dasharray", dash);
    return;
  }
  map.addSource(ROUTE_SOURCE, { type: "geojson", data });
  map.addLayer({
    id: ROUTE_LAYER,
    type: "line",
    source: ROUTE_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#334155",
      "line-width": route.kind === "road" ? 3 : 2.5,
      ...(dash && { "line-dasharray": dash }),
    },
  });
}
