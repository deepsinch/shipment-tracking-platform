"use client";

import { LocateFixedIcon, MapPinOffIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";

import { LiveRefresh } from "@/components/realtime/live-refresh";
import { useRealtime } from "@/components/realtime/realtime-provider";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { useNow } from "@/components/use-now";
import { formatDateTime, formatElapsed, formatPlace } from "@/lib/format";
import { formatCoordinates } from "@/lib/geo";
import {
  applyPositionEvent,
  isUnknownShipment,
  mergeFleet,
  sortFleetForList,
  type FleetShipment,
  type LiveFixes,
} from "@/lib/live-positions";
import type { RealtimeClientEvent } from "@/lib/realtime-events";
import { statusMarkerColor } from "@/lib/status-tone";
import { cn } from "@/lib/utils";

import { MapFrame, MapLoading } from "./map-frame";

// MapLibre is browser-only and large: it loads in its own chunk after the page, never on the server.
const FleetMapCanvas = dynamic(() => import("./fleet-map-canvas"), {
  ssr: false,
  loading: MapLoading,
});

/** Relative times tick at this pace; pings come every 10 s at most. */
const CLOCK_TICK_MS = 5_000;

/**
 * The dispatcher's live map: a map with a marker per active shipment, and the same shipments as a
 * list of links beside it (under it on a phone), so the information never depends on the map.
 *
 * `snapshot` comes from the server (`getShipmentPositions`). Realtime position events move
 * markers and list entries in place; the snapshot decides which shipments exist, and the page
 * re-renders it (`LiveRefresh`) on every resync and shipment change, so a finished shipment drops
 * off and a newly started one appears with its first ping.
 */
export function FleetMap({ snapshot }: { snapshot: FleetShipment[] }) {
  const [fixes, setFixes] = useState<LiveFixes>(() => new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const now = useNow(CLOCK_TICK_MS);

  // An open popup is a transient choice: closed when Next hides the page, not restored with it.
  useLayoutEffect(() => () => setSelectedId(null), []);

  useRealtime((event) => {
    if (event.kind === "position") setFixes((current) => applyPositionEvent(current, event));
  });

  const shipments = mergeFleet(snapshot, fixes);
  const listed = sortFleetForList(shipments);
  // A selection whose shipment has just finished is no selection.
  const selected = shipments.some((s) => s.shipmentId === selectedId) ? selectedId : null;

  const refreshFor = (event: RealtimeClientEvent) =>
    event.kind === "position" && isUnknownShipment(snapshot, event);

  function showOnMap(shipmentId: string) {
    setSelectedId(shipmentId);
    mapRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <LiveRefresh alsoOn={refreshFor} />
      <div ref={mapRef} className="scroll-mt-4">
        <MapFrame className="h-[55vh] min-h-80 lg:h-[calc(100dvh-15rem)] lg:min-h-[28rem]">
          <FleetMapCanvas
            shipments={shipments}
            selectedId={selected}
            onSelect={setSelectedId}
            renderPopup={(shipment) => <ShipmentPopup shipment={shipment} now={now} />}
          />
          {shipments.length === 0 && <EmptyMapNotice />}
        </MapFrame>
      </div>

      <section
        aria-labelledby="fleet-list-heading"
        className="flex flex-col rounded-xl border bg-card lg:h-[calc(100dvh-15rem)] lg:min-h-[28rem]"
      >
        <div className="border-b px-4 py-3">
          <h2 id="fleet-list-heading" className="font-medium">
            On the map{" "}
            <span className="text-muted-foreground" data-testid="fleet-count">
              ({shipments.length})
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Unfinished shipments with a known position. Problems first.
          </p>
        </div>
        {listed.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No shipment has shared a location yet. Shipments appear here and on the map once their
            driver shares their location.
          </p>
        ) : (
          <ul aria-label="Shipments on the map" className="flex-1 divide-y overflow-y-auto">
            {listed.map((shipment) => (
              <FleetListItem
                key={shipment.shipmentId}
                shipment={shipment}
                now={now}
                selected={shipment.shipmentId === selected}
                onShow={() => showOnMap(shipment.shipmentId)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function FleetListItem({
  shipment,
  now,
  selected,
  onShow,
}: {
  shipment: FleetShipment;
  now: number | null;
  selected: boolean;
  onShow: () => void;
}) {
  return (
    <li
      data-testid="fleet-list-item"
      data-shipment-id={shipment.shipmentId}
      className={cn("flex items-start gap-3 px-4 py-3", selected && "bg-muted/60")}
    >
      <span
        aria-hidden="true"
        className="mt-1.5 size-2.5 shrink-0 rounded-full ring-2 ring-white"
        style={{ backgroundColor: statusMarkerColor(shipment.status) }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/dashboard/shipments/${shipment.shipmentId}`}
            className="font-mono text-sm font-medium underline-offset-4 hover:underline"
          >
            {shipment.trackingCode}
          </Link>
          <StatusBadge status={shipment.status} />
        </div>
        <p className="text-sm">
          To {formatPlace(shipment.destinationCity, shipment.destinationCountry)}
        </p>
        <p className="text-xs text-muted-foreground" data-testid="fleet-last-seen">
          Last seen <LastSeenTime recordedAt={shipment.recordedAt} now={now} /> · near{" "}
          {formatCoordinates(shipment)}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="-mr-2 shrink-0"
        onClick={onShow}
        aria-pressed={selected}
      >
        <LocateFixedIcon aria-hidden="true" />
        <span className="sr-only">Show {shipment.trackingCode} on the map</span>
      </Button>
    </li>
  );
}

function ShipmentPopup({ shipment, now }: { shipment: FleetShipment; now: number | null }) {
  return (
    <div className="flex min-w-48 flex-col gap-1.5 text-sm" data-testid="map-popup">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/dashboard/shipments/${shipment.shipmentId}`}
          className="font-mono font-semibold underline underline-offset-4"
        >
          {shipment.trackingCode}
        </Link>
        <StatusBadge status={shipment.status} />
      </div>
      <p>To {formatPlace(shipment.destinationCity, shipment.destinationCountry)}</p>
      <p className="text-slate-600">
        Last seen <LastSeenTime recordedAt={shipment.recordedAt} now={now} />
      </p>
    </div>
  );
}

/** "3 min ago" once the viewer's clock is known, the UTC time before (server render). */
function LastSeenTime({ recordedAt, now }: { recordedAt: string; now: number | null }) {
  const date = new Date(recordedAt);
  return (
    <time dateTime={recordedAt} title={formatDateTime(date)}>
      {now === null ? formatDateTime(date) : formatElapsed(now - date.getTime())}
    </time>
  );
}

function EmptyMapNotice() {
  return (
    // The list beside the map says the same, so screen readers hear it once.
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-4 top-4 z-10 mx-auto flex max-w-sm items-start gap-3 rounded-lg border bg-white/95 px-4 py-3 text-sm text-slate-700 shadow-md"
    >
      <MapPinOffIcon className="mt-0.5 size-4 shrink-0 text-slate-500" aria-hidden="true" />
      <p>
        No shipments on the map right now. They appear as soon as a driver shares their location.
      </p>
    </div>
  );
}
