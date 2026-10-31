import { ArrowLeftIcon, ArrowRightIcon, ExternalLinkIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { LiveRefresh } from "@/components/realtime/live-refresh";
import { StatusBadge } from "@/components/status-badge";
import { ShipmentHistory } from "@/components/shipment-history";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SERVICE_LEVEL_LABELS } from "@/domain/service-level";
import { canAssignDrivers, canChangeDriver, statusOptionsFor } from "@/domain/shipment-permissions";
import { isTerminalStatus } from "@/domain/shipment-status";
import { formatDateTime, formatPlace, formatWeight } from "@/lib/format";
import type { LivePosition } from "@/components/realtime/use-live-position";
import { requireAuthContextOn, type AuthContext } from "@/server/auth/session";
import type { Shipment } from "@/server/db/schema";
import { getShipment } from "@/server/services/get-shipment";
import { getShipmentPositions } from "@/server/services/get-shipment-positions";
import { listDrivers } from "@/server/services/list-drivers";

import { AssignDriverForm } from "./assign-driver-form";
import { LastSeen } from "./last-seen";
import { StatusChangeForm } from "./status-change-form";

/** One lookup per request, shared by the metadata and the page. Not found ends both. */
const loadShipment = cache(async (id: string) => {
  const ctx = await requireAuthContextOn("/dashboard");
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
  // Only staff reach this page, but the role rule decides, not the route.
  const driverList = canAssignDrivers(ctx.role) ? await listDrivers(ctx) : null;
  const drivers = driverList?.ok ? driverList.drivers : null;
  const lastPosition = await loadLastPosition(ctx, shipment);

  return (
    <main className="flex flex-col gap-6">
      <LiveRefresh shipmentId={shipment.id} />
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

      {/* DOM order (details, status, driver, history) is also the mobile order. */}
      {/* Row 1 sizes to the details; the taller side column grows into row 2, not row 1. */}
      <div className="grid items-start gap-6 lg:grid-cols-3 lg:grid-rows-[auto_1fr]">
        <ShipmentDetails
          shipment={shipment}
          assignedDriverName={assignedDriverName}
          lastPosition={lastPosition}
          className="lg:col-span-2"
        />
        <div className="flex flex-col gap-6 lg:col-start-3 lg:row-span-2 lg:row-start-1">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Update status</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Server-rendered props; the form re-reads them after every revalidation. */}
              <StatusChangeForm
                shipmentId={shipment.id}
                trackingCode={shipment.trackingCode}
                version={shipment.version}
                status={shipment.status}
                options={options}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Driver</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {drivers && canChangeDriver(shipment.status) ? (
                <AssignDriverForm
                  shipmentId={shipment.id}
                  version={shipment.version}
                  assignedDriverId={shipment.assignedDriverId}
                  drivers={drivers}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {assignedDriverName ?? "No driver"}
                  {canChangeDriver(shipment.status)
                    ? "."
                    : ". The driver of a finished shipment can no longer change."}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
        <ShipmentHistory events={events} className="lg:col-span-2" />
      </div>
    </main>
  );
}

/**
 * The latest position for the "Last seen" line, or undefined when the line is not shown: a
 * finished shipment's last position no longer matters (the snapshot leaves it out too).
 */
async function loadLastPosition(
  ctx: AuthContext,
  shipment: Shipment,
): Promise<LivePosition | null | undefined> {
  if (isTerminalStatus(shipment.status)) return undefined;
  const result = await getShipmentPositions(ctx, { shipmentIds: [shipment.id] });
  const position = result.ok ? result.positions[0] : undefined;
  return position
    ? { lat: position.lat, lng: position.lng, recordedAt: position.recordedAt.toISOString() }
    : null;
}

function ShipmentDetails({
  shipment,
  assignedDriverName,
  lastPosition,
  className,
}: {
  shipment: Shipment;
  assignedDriverName: string | null;
  lastPosition: LivePosition | null | undefined;
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
          {lastPosition !== undefined && (
            <Detail label="Last seen">
              <LastSeen shipmentId={shipment.id} initial={lastPosition} />
            </Detail>
          )}
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
