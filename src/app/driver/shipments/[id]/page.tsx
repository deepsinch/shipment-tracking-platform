import { ArrowLeftIcon, NavigationIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { ShipmentHistory } from "@/components/shipment-history";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { nextStopFor, type NextStop } from "@/domain/driver-tasks";
import { isLocationSharingStatus } from "@/domain/location-sharing";
import { SERVICE_LEVEL_LABELS } from "@/domain/service-level";
import { statusOptionsFor } from "@/domain/shipment-permissions";
import { formatCountry, formatPlace, formatWeight } from "@/lib/format";
import { requireAuthContextOn } from "@/server/auth/session";
import type { Shipment } from "@/server/db/schema";
import { getShipment } from "@/server/services/get-shipment";

import { DueTime } from "../../due-time";
import { DriverStatusForm } from "./driver-status-form";
import { LocationSharing } from "./location-sharing";

/** One lookup per request, shared by the metadata and the page. Not found ends both. */
const loadShipment = cache(async (id: string) => {
  const ctx = await requireAuthContextOn("/driver");
  const result = await getShipment(ctx, id);
  if (!result.ok) notFound();
  return { ctx, ...result };
});

export async function generateMetadata({
  params,
}: PageProps<"/driver/shipments/[id]">): Promise<Metadata> {
  const { shipment } = await loadShipment((await params).id);
  return { title: shipment.trackingCode };
}

export default async function DriverShipmentPage({ params }: PageProps<"/driver/shipments/[id]">) {
  const { ctx, shipment, events } = await loadShipment((await params).id);
  const stop = nextStopFor(shipment.status);

  return (
    <main className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Link
          href="/driver"
          className="-ml-1 flex min-h-11 w-fit items-center gap-1 rounded-md px-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          My shipments
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight">
            {shipment.trackingCode}
          </h1>
          <StatusBadge status={shipment.status} />
        </div>
      </div>

      {stop && <NextStopCard shipment={shipment} stop={stop} now={new Date()} />}

      {/* Only while on the road: when the status moves on, this unmounts and sharing stops. */}
      {isLocationSharingStatus(shipment.status) && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Location</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LocationSharing key={shipment.id} shipmentId={shipment.id} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Update status</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DriverStatusForm
            shipmentId={shipment.id}
            version={shipment.version}
            status={shipment.status}
            options={statusOptionsFor(ctx.role, shipment.status)}
          />
        </CardContent>
      </Card>

      <RouteCard shipment={shipment} />
      <ShipmentHistory events={events} />
    </main>
  );
}

/** Where to go now, with the deadline and a hand-off to the phone's maps app. */
function NextStopCard({ shipment, stop, now }: { shipment: Shipment; stop: NextStop; now: Date }) {
  const place =
    stop === "pickup"
      ? {
          heading: "Next stop: pickup",
          line: shipment.originAddressLine,
          postalCode: shipment.originPostalCode,
          city: shipment.originCity,
          country: shipment.originCountry,
        }
      : {
          heading: "Next stop: delivery",
          line: shipment.destinationAddressLine,
          postalCode: shipment.destinationPostalCode,
          city: shipment.destinationCity,
          country: shipment.destinationCountry,
        };
  const query = [place.line, place.postalCode, place.city, formatCountry(place.country)]
    .filter(Boolean)
    .join(", ");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{place.heading}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          {stop === "delivery" && <p className="font-medium">{shipment.recipientName}</p>}
          <address className="text-base not-italic">
            {place.line}
            <br />
            {[place.postalCode, formatPlace(place.city, place.country)].filter(Boolean).join(" ")}
          </address>
        </div>
        <DueTime shipment={shipment} now={now} label="Delivery due" />
        <Button asChild variant="outline" size="lg" className="h-12 text-base">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <NavigationIcon aria-hidden="true" />
            Open in Maps
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

function RouteCard({ shipment }: { shipment: Shipment }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Shipment</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
          <Detail label="From">{formatPlace(shipment.originCity, shipment.originCountry)}</Detail>
          <Detail label="To">
            {formatPlace(shipment.destinationCity, shipment.destinationCountry)}
          </Detail>
          <Detail label="Recipient">{shipment.recipientName}</Detail>
          <Detail label="Service">{SERVICE_LEVEL_LABELS[shipment.serviceLevel]}</Detail>
          <Detail label="Weight">{formatWeight(shipment.weightKg)}</Detail>
          {shipment.reference && <Detail label="Reference">{shipment.reference}</Detail>}
        </dl>
      </CardContent>
    </Card>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
