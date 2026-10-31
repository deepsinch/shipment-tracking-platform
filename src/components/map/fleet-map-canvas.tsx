"use client";

import { Marker, Popup, type LngLat, type MapMouseEvent } from "maplibre-gl";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { boundsOf, WESTERN_EUROPE } from "@/lib/geo";
import type { FleetShipment } from "@/lib/live-positions";

import {
  cancelGlide,
  glideMarker,
  prefersReducedMotion,
  useMapLibreMap,
  type MapLibreMap,
} from "./maplibre";
import {
  createShipmentMarkerElement,
  SHIPMENT_MARKER_SELECTOR,
  updateShipmentMarkerElement,
} from "./marker-elements";
import { MapUnavailable } from "./map-frame";

export type FleetMapCanvasProps = {
  shipments: readonly FleetShipment[];
  /** The shipment whose popup is open; it must be one of `shipments`. */
  selectedId: string | null;
  onSelect: (shipmentId: string | null) => void;
  /** The popup's content, rendered by React into MapLibre's popup. */
  renderPopup: (shipment: FleetShipment) => ReactNode;
};

/**
 * The dashboard's map: one marker per shipment, gliding to each new fix, and a popup for the
 * selected one. Loaded only in the browser (`next/dynamic` with `ssr: false` in `FleetMap`), so
 * MapLibre never reaches the server bundle or the initial page load.
 *
 * Markers and the popup are MapLibre objects kept in sync with props by effects, not React
 * elements: MapLibre owns their position on every frame. The popup's content is a React portal,
 * so links and badges inside it are ordinary components.
 */
export default function FleetMapCanvas({
  shipments,
  selectedId,
  onSelect,
  renderPopup,
}: FleetMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { map, failed } = useMapLibreMap(containerRef, {
    label: "Map of active shipments",
    bounds: boundsOf(shipments) ?? WESTERN_EUROPE,
  });
  const markers = useRef(new Map<string, Marker>());
  const openPopup = useRef<{ shipmentId: string; popup: Popup } | null>(null);
  const [popupContent] = useState(() => document.createElement("div"));
  const select = useEffectEvent(onSelect);

  // Markers go when the map goes (unmount, or the route hidden by Activity).
  useEffect(() => {
    if (!map) return;
    const registry = markers.current;
    return () => {
      for (const marker of registry.values()) {
        cancelGlide(marker);
        marker.remove();
      }
      registry.clear();
    };
  }, [map]);

  // One marker per shipment: added, updated and moved in place, removed when the shipment leaves.
  useEffect(() => {
    if (!map) return;
    const registry = markers.current;
    const present = new Set<string>();

    for (const shipment of shipments) {
      const { shipmentId } = shipment;
      present.add(shipmentId);
      let marker = registry.get(shipmentId);
      const isNew = !marker;
      if (!marker) {
        const element = createShipmentMarkerElement(true);
        element.addEventListener("click", () => select(shipmentId));
        marker = new Marker({ element, subpixelPositioning: true })
          .setLngLat([shipment.lng, shipment.lat])
          .addTo(map);
        registry.set(shipmentId, marker);
      }
      updateShipmentMarkerElement(marker.getElement(), shipment, shipment);
      glideMarker(marker, shipment, {
        animate: !isNew,
        onFrame: (position) => {
          const open = openPopup.current;
          if (open?.shipmentId === shipmentId) open.popup.setLngLat([position.lng, position.lat]);
        },
      });
    }

    for (const [shipmentId, marker] of registry) {
      if (present.has(shipmentId)) continue;
      cancelGlide(marker);
      marker.remove();
      registry.delete(shipmentId);
    }
  }, [map, shipments]);

  // Clicking the map itself, or Escape, closes the popup.
  useEffect(() => {
    if (!map) return;
    // MapLibre reports a click on a marker as a map click too (it watches pointer events on the
    // whole container), so those are left to the marker's own handler.
    const onMapClick = (event: MapMouseEvent) => {
      const target = event.originalEvent.target;
      if (target instanceof Element && target.closest(SHIPMENT_MARKER_SELECTOR)) return;
      select(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") select(null);
    };
    const container = map.getContainer();
    map.on("click", onMapClick);
    container.addEventListener("keydown", onKeyDown);
    return () => {
      map.off("click", onMapClick);
      container.removeEventListener("keydown", onKeyDown);
    };
  }, [map]);

  // The selected shipment's popup, anchored to its marker.
  useEffect(() => {
    if (!map || !selectedId) return;
    const marker = markers.current.get(selectedId);
    if (!marker) return;

    const element = marker.getElement();
    const lngLat = marker.getLngLat();
    const popup = new Popup({ offset: 22, closeOnClick: false, maxWidth: "18rem" })
      .setDOMContent(popupContent)
      .setLngLat(lngLat);
    // Closed by its own button: deselect, and hand focus back to the marker it came from.
    const onClose = () => {
      select(null);
      if (popupContent.contains(document.activeElement) || document.activeElement === document.body)
        element.focus({ preventScroll: true });
    };
    popup.on("close", onClose);
    popup.addTo(map);
    openPopup.current = { shipmentId: selectedId, popup };
    element.dataset.selected = "";
    element.style.zIndex = "1";

    // Off screen, or too close to an edge for the popup (chosen from the list): bring it in.
    if (!hasRoomForPopup(map, lngLat)) {
      map.easeTo({ center: lngLat, duration: prefersReducedMotion() ? 0 : 600 });
    }

    return () => {
      popup.off("close", onClose);
      popup.remove();
      openPopup.current = null;
      delete element.dataset.selected;
      element.style.zIndex = "";
    };
  }, [map, selectedId, popupContent]);

  const selected = shipments.find((shipment) => shipment.shipmentId === selectedId);

  return (
    <>
      {/* Sized by the frame; MapLibre makes this element `position: relative`. */}
      <div ref={containerRef} className="size-full" />
      {failed && <MapUnavailable />}
      {selected && createPortal(renderPopup(selected), popupContent)}
    </>
  );
}

/** The popup opens above its marker: leave space for it below the top edge and the controls. */
function hasRoomForPopup(map: MapLibreMap, lngLat: LngLat): boolean {
  const { x, y } = map.project(lngLat);
  const { clientWidth: width, clientHeight: height } = map.getContainer();
  return x > 48 && x < width - 48 && y > 150 && y < height - 32;
}
