import { ChevronRightIcon, PackageCheckIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { nextStopFor } from "@/domain/driver-tasks";
import { formatPlace } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireAuthContextOn } from "@/server/auth/session";
import {
  listAssignedShipments,
  type AssignedShipment,
} from "@/server/services/list-assigned-shipments";

import { DueTime } from "./due-time";

export const metadata: Metadata = { title: "My shipments" };

export default async function DriverHomePage() {
  const ctx = await requireAuthContextOn("/driver");
  const { active, finished } = await listAssignedShipments(ctx);
  // One clock for the whole list, read at request time (after the session read above).
  const now = new Date();

  return (
    <main className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">My shipments</h1>
        <p className="text-sm text-muted-foreground">
          {active.length === 0
            ? "Nothing to do right now."
            : `${active.length} to do, most urgent first.`}
        </p>
      </div>

      <section aria-labelledby="active-heading" className="flex flex-col gap-3">
        <h2 id="active-heading" className="sr-only">
          To do
        </h2>
        {active.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card px-4 py-10 text-center">
            <PackageCheckIcon className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">No shipments assigned to you</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              When dispatch assigns you a shipment, it shows up here.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {active.map((shipment) => (
              <li key={shipment.id}>
                <ShipmentCard shipment={shipment} now={now} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {finished.length > 0 && (
        <section aria-labelledby="finished-heading" className="flex flex-col gap-3">
          <h2 id="finished-heading" className="text-sm font-medium text-muted-foreground">
            Recently finished
          </h2>
          <ul className="flex flex-col gap-2">
            {finished.map((shipment) => (
              <li key={shipment.id}>
                <ShipmentCard shipment={shipment} now={now} compact />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/**
 * One shipment as a large tap target. Active shipments lead with where to go next (pickup before
 * collection, delivery after) and the deadline; finished ones are a single line.
 */
function ShipmentCard({
  shipment,
  now,
  compact = false,
}: {
  shipment: AssignedShipment;
  now: Date;
  compact?: boolean;
}) {
  const stop = nextStopFor(shipment.status);
  const atPickup = stop === "pickup";

  return (
    <Link
      href={`/driver/shipments/${shipment.id}`}
      className={cn(
        "group flex items-center gap-3 rounded-xl border bg-card text-card-foreground shadow-xs transition-colors outline-none hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50",
        compact ? "px-4 py-3" : "p-4",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="font-mono text-sm font-medium">{shipment.trackingCode}</span>
          <StatusBadge status={shipment.status} />
        </div>
        {compact ? (
          <p className="truncate text-sm text-muted-foreground">
            To {formatPlace(shipment.destinationCity, shipment.destinationCountry)}
          </p>
        ) : (
          <>
            <div className="flex flex-col">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {atPickup ? "Pickup" : "Deliver to"}
              </span>
              <span className="text-base font-medium">
                {atPickup ? shipment.originAddressLine : shipment.destinationAddressLine}
              </span>
              <span className="text-sm text-muted-foreground">
                {atPickup
                  ? formatPlace(shipment.originCity, shipment.originCountry)
                  : `${shipment.recipientName} · ${formatPlace(shipment.destinationCity, shipment.destinationCountry)}`}
              </span>
            </div>
            <DueTime shipment={shipment} now={now} />
          </>
        )}
      </div>
      <ChevronRightIcon
        className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}
