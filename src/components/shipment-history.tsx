import { LockIcon, MapPinIcon } from "lucide-react";

import { Timeline, TimelineItem } from "@/components/timeline";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { driverAssignmentTitle, shipmentEventTitle } from "@/domain/shipment-event";
import { formatDateTime } from "@/lib/format";
import type { ShipmentEventWithActor } from "@/server/services/get-shipment";

/**
 * The organization's view of a shipment's history (newest first), internal notes and driver
 * changes included. Used by the dashboard and the driver app; the public page has its own,
 * reduced timeline.
 */
export function ShipmentHistory({
  events,
  className,
}: {
  events: ShipmentEventWithActor[];
  className?: string;
}) {
  const newestFirst = [...events].reverse();
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>
          <h2>History</h2>
        </CardTitle>
        <CardDescription>Every change is recorded and cannot be edited.</CardDescription>
      </CardHeader>
      <CardContent>
        <Timeline aria-label="Shipment history">
          {newestFirst.map((event, index) => (
            <TimelineItem key={event.id} highlighted={index === 0}>
              <div className="flex flex-col gap-1 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="font-medium">{eventTitle(event)}</span>
                  <time dateTime={event.occurredAt.toISOString()} className="text-muted-foreground">
                    {formatDateTime(event.occurredAt)}
                  </time>
                </div>
                <p className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
                  <span>by {event.actorName ?? "System"}</span>
                  {event.locationCity && (
                    <>
                      <span aria-hidden="true">·</span>
                      <MapPinIcon className="size-3.5" aria-hidden="true" />
                      <span>{event.locationCity}</span>
                    </>
                  )}
                </p>
                {event.publicNote && (
                  <p>
                    <span className="sr-only">Note for the customer: </span>
                    {event.publicNote}
                  </p>
                )}
                {event.internalNote && (
                  <p className="flex items-start gap-1.5 rounded-md bg-muted px-2 py-1.5">
                    <LockIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      <span className="sr-only">Internal note: </span>
                      {event.internalNote}
                    </span>
                  </p>
                )}
              </div>
            </TimelineItem>
          ))}
        </Timeline>
      </CardContent>
    </Card>
  );
}

function eventTitle(event: ShipmentEventWithActor): string {
  return event.assignment
    ? driverAssignmentTitle(event.assignment.fromName, event.assignment.toName)
    : shipmentEventTitle(event.type, event.toStatus);
}
