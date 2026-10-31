import { shipmentStatusLabel, type ShipmentStatus } from "@/domain/shipment-status";
import { statusMarkerColor } from "@/lib/status-tone";

/**
 * DOM elements for MapLibre markers. Markers live outside React's tree (MapLibre positions them),
 * so they are built here with plain DOM calls; every text goes through `textContent` or
 * attributes, never `innerHTML`, and the only markup strings are the static icons below.
 *
 * MapLibre moves a marker by setting `transform` on the element it is given. Visual effects
 * therefore go on an inner disc: CSS applies the separate `scale` property before `transform`, so
 * scaling the outer element would scale MapLibre's translation too and throw the marker off its
 * position (found in the visual check: hovering moved markers away from the pointer). Nothing
 * transitions `transform` either, or panning would lag.
 */

// Lucide icons (ISC licence), the same set the rest of the UI uses through lucide-react.
const SVG_ATTRIBUTES =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
const TRUCK_ICON = `<svg ${SVG_ATTRIBUTES} class="size-4"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>`;
const ALERT_ICON = `<svg ${SVG_ATTRIBUTES} class="size-4"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`;

const DISC_CLASSES =
  "grid size-8 place-items-center rounded-full border-2 border-white text-white shadow-md ring-1 ring-black/15 transition-[scale] duration-150 motion-reduce:transition-none";

/** Matches the shipment markers this module creates. */
export const SHIPMENT_MARKER_SELECTOR = "[data-shipment-marker]";

export type ShipmentMarkerData = {
  shipmentId: string;
  trackingCode: string;
  status: ShipmentStatus;
  destinationCity: string;
};

/** "WB-7K2M-9QXD, In transit, to Antwerp": what the marker says to assistive technology. */
export function shipmentMarkerLabel(data: ShipmentMarkerData): string {
  return `${data.trackingCode}, ${shipmentStatusLabel(data.status)}, to ${data.destinationCity}`;
}

/**
 * A round, status-coloured truck marker (a warning sign for exceptions). Interactive markers are
 * buttons, so they are focusable and announce their label; on the detail page the marker is a
 * plain image.
 */
export function createShipmentMarkerElement(interactive: boolean): HTMLElement {
  const element = document.createElement(interactive ? "button" : "div");
  element.className = "group block rounded-full";
  element.dataset.testid = "map-marker";
  element.dataset.shipmentMarker = "";
  if (interactive) {
    (element as HTMLButtonElement).type = "button";
    element.classList.add(
      "cursor-pointer",
      "focus-visible:outline-2",
      "focus-visible:outline-offset-2",
      "focus-visible:outline-slate-900",
    );
  } else {
    element.setAttribute("role", "img");
  }
  const disc = document.createElement("span");
  disc.className = DISC_CLASSES;
  if (interactive) disc.classList.add("group-hover:scale-110", "group-data-[selected]:scale-125");
  element.append(disc);
  return element;
}

/** Brings a shipment marker in line with the shipment: colour, icon, label and test hooks. */
export function updateShipmentMarkerElement(
  element: HTMLElement,
  data: ShipmentMarkerData,
  position: { lat: number; lng: number },
): void {
  const label = shipmentMarkerLabel(data);
  if (element.getAttribute("aria-label") !== label) element.setAttribute("aria-label", label);
  const disc = element.firstElementChild as HTMLElement;
  disc.style.backgroundColor = statusMarkerColor(data.status);
  if (element.dataset.status !== data.status) {
    element.dataset.status = data.status;
    disc.innerHTML = data.status === "exception" ? ALERT_ICON : TRUCK_ICON;
  }
  element.dataset.shipmentId = data.shipmentId;
  // Where the marker is heading (it may still be gliding there): for tests and debugging.
  element.dataset.lat = String(position.lat);
  element.dataset.lng = String(position.lng);
}

/**
 * A pickup or delivery pin: a small dot with the city name beside it. Pickup is hollow, delivery
 * filled, the convention of most route maps. Purely visual: the page shows both addresses as text.
 */
export function createStopMarkerElement(kind: "pickup" | "delivery", city: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "pointer-events-none flex items-center gap-1.5";
  element.dataset.testid = `map-${kind}`;
  element.setAttribute("role", "img");
  element.setAttribute("aria-label", `${kind === "pickup" ? "Pickup" : "Delivery"}: ${city}`);

  const dot = document.createElement("span");
  dot.className =
    kind === "pickup"
      ? "size-3.5 rounded-full border-[3px] border-slate-800 bg-white shadow-sm"
      : "size-3.5 rounded-full border-2 border-white bg-slate-800 shadow-sm ring-1 ring-slate-800";
  const name = document.createElement("span");
  name.className =
    "rounded bg-white/90 px-1.5 py-0.5 text-xs font-medium text-slate-800 shadow-sm ring-1 ring-black/10";
  name.textContent = city;
  name.setAttribute("aria-hidden", "true");

  element.append(dot, name);
  return element;
}
