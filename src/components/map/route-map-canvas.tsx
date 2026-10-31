"use client";

import { Marker, type GeoJSONSource } from "maplibre-gl";
import { useEffect, useRef } from "react";

import type { ShipmentStatus } from "@/domain/shipment-status";
import { boundsOf, WESTERN_EUROPE, type LatLng, type LineString } from "@/lib/geo";
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
  /** The route to draw. A straight line for now; road geometry later, with no change here. */
  route: LineString | null;
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

function showRoute(map: MapLibreMap, route: LineString): void {
  const data = { type: "Feature" as const, properties: {}, geometry: route };
  const source = map.getSource<GeoJSONSource>(ROUTE_SOURCE);
  if (source) {
    source.setData(data);
    return;
  }
  map.addSource(ROUTE_SOURCE, { type: "geojson", data });
  map.addLayer({
    id: "route-line",
    type: "line",
    source: ROUTE_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    // Dashed: a straight line is where the shipment is going, not the road it takes.
    paint: { "line-color": "#334155", "line-width": 2.5, "line-dasharray": [1, 2] },
  });
}
