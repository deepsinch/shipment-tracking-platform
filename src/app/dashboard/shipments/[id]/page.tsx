import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  LockIcon,
  MapPinIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Timeline, TimelineItem } from "@/components/timeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SERVICE_LEVEL_LABELS } from "@/domain/service-level";
import { shipmentEventTitle } from "@/domain/shipment-event";
import { statusOptionsFor } from "@/domain/shipment-permissions";
import { formatDateTime, formatPlace, formatWeight } from "@/lib/format";
import { requireAuthContext } from "@/server/auth/session";
import type { Shipment } from "@/server/db/schema";
import { getShipment, type ShipmentEventWithActor } from "@/server/services/get-shipment";

import { StatusChangeForm } from "./status-change-form";

/** One lookup per request, shared by the metadata and the page. Not found ends both. */
const loadShipment = cache(async (id: string) => {
  const ctx = await requireAuthContext();
  const result = await getShipment(ctx, id);
  if (!result.ok) notFound();
  return { ctx, ...result };
});

export async function generateMetadata({
  params,
}: PageProps<"/dashboard/shipments/[id]">): Promise<Metadata> {
  const { shipment } = await loadShipment((await params).id);
  return { title: shipment.trackingCode };
}

export default async function ShipmentPage({ params }: PageProps<"/dashboard/shipments/[id]">) {
  const { ctx, shipment, assignedDriverName, events } = await loadShipment((await params).id);
  const options = statusOptionsFor(ctx.role, shipment.status);

  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/dashboard/shipments"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          Shipments
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">
              {shipment.trackingCode}
            </h1>
            <StatusBadge status={shipment.status} />
          </div>
          <Button asChild variant="outline">
            <Link href={`/track/${shipment.trackingCode}`} target="_blank" rel="noopener">
              <ExternalLinkIcon aria-hidden="true" />
              Public tracking page
              <span className="sr-only">(opens in a new tab)</span>
            </Link>
          </Button>
        </div>
        {shipment.reference && (
          <p className="text-sm text-muted-foreground">Reference {shipment.reference}</p>
        )}
      </div>

      {/* DOM order (details, status, history) is also the mobile order. */}
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <ShipmentDetails
          shipment={shipment}
          assignedDriverName={assignedDriverName}
          className="lg:col-span-2"
        />
        <Card className="lg:col-start-3 lg:row-span-2 lg:row-start-1">
          <CardHeader>
            <CardTitle>
              <h2>Update status</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Server-rendered props; the form re-reads them after every revalidation. */}
            <StatusChangeForm
              shipmentId={shipment.id}
              version={shipment.version}
              status={shipment.status}
              options={options}
            />
          </CardContent>
        </Card>
        <ShipmentHistory events={events} className="lg:col-span-2" />
      </div>
    </main>
  );
}

function ShipmentDetails({
  shipment,
  assignedDriverName,
  className,
}: {
  shipment: Shipment;
  assignedDriverName: string | null;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>
          <h2>Details</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
          <Address
            label="Pickup"
            line={shipment.originAddressLine}
            postalCode={shipment.originPostalCode}
            city={shipment.originCity}
            country={shipment.originCountry}
          />
          <ArrowRightIcon
            className="hidden size-4 text-muted-foreground sm:mt-6 sm:block"
            aria-hidden="true"
          />
          <Address
            label="Delivery"
            line={shipment.destinationAddressLine}
            postalCode={shipment.destinationPostalCode}
            city={shipment.destinationCity}
            country={shipment.destinationCountry}
          />
        </div>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Detail label="Recipient">
            {shipment.recipientName}
            {shipment.recipientEmail && (
              <span className="block text-muted-foreground">{shipment.recipientEmail}</span>
            )}
          </Detail>
          <Detail label="Driver">{assignedDriverName ?? "Not assigned"}</Detail>
          <Detail label="Weight">{formatWeight(shipment.weightKg)}</Detail>
          <Detail label="Service level">{SERVICE_LEVEL_LABELS[shipment.serviceLevel]}</Detail>
          <Detail label="Promised delivery">
            {shipment.promisedDeliveryAt ? formatDateTime(shipment.promisedDeliveryAt) : "—"}
          </Detail>
          <Detail label="Created">{formatDateTime(shipment.createdAt)}</Detail>
        </dl>
      </CardContent>
    </Card>
  );
}

function Address(props: {
  label: string;
  line: string;
  postalCode: string | null;
  city: string;
  country: string;
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{props.label}</span>
      <address className="not-italic">
        {props.line}
        <br />
        {[props.postalCode, formatPlace(props.city, props.country)].filter(Boolean).join(" ")}
      </address>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ShipmentHistory({
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
                  <span className="font-medium">
                    {shipmentEventTitle(event.type, event.toStatus)}
                  </span>
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
