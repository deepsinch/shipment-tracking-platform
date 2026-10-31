import {
  ArrowDownIcon,
  CalendarClockIcon,
  CircleCheckIcon,
  CircleXIcon,
  MapPinIcon,
  PackageCheckIcon,
  PackageIcon,
  TriangleAlertIcon,
  TruckIcon,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { Timeline, TimelineItem } from "@/components/timeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { shipmentEventTitle } from "@/domain/shipment-event";
import { shipmentStatusLabel, type ShipmentStatus } from "@/domain/shipment-status";
import {
  DELIVERY_STEPS,
  trackingProgress,
  type TrackingProgress,
} from "@/domain/tracking-progress";
import { formatDate, formatDateTime, formatPlace } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getPublicTracking, type PublicTracking } from "@/server/services/public-tracking";

/** Shared by the metadata and the page, so one request looks the code up once. */
const lookUp = cache(getPublicTracking);

/** Tracking data belongs to whoever holds the code: keep every page out of search engines. */
const robots: Metadata["robots"] = { index: false, follow: false };

export async function generateMetadata({ params }: PageProps<"/track/[code]">): Promise<Metadata> {
  const tracking = await lookUp((await params).code);
  return {
    title: tracking ? `Tracking ${tracking.trackingCode}` : "Shipment not found",
    robots,
  };
}

/** What each status means to a customer, in plain words. */
const STATUS_COPY: Record<ShipmentStatus, { icon: LucideIcon; text: string; tone: string }> = {
  created: {
    icon: PackageIcon,
    text: "The sender has booked this shipment. It will be picked up soon.",
    tone: "bg-secondary text-secondary-foreground",
  },
  picked_up: {
    icon: PackageCheckIcon,
    text: "The carrier has collected your shipment.",
    tone: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  },
  in_transit: {
    icon: TruckIcon,
    text: "Your shipment is on its way.",
    tone: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  },
  out_for_delivery: {
    icon: TruckIcon,
    text: "Your shipment is on the delivery vehicle and will arrive soon.",
    tone: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  },
  delivered: {
    icon: CircleCheckIcon,
    text: "Your shipment has been delivered.",
    tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  exception: {
    icon: TriangleAlertIcon,
    text: "Your shipment is delayed. The carrier is working on it.",
    tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  cancelled: {
    icon: CircleXIcon,
    text: "This shipment was cancelled. Contact the sender for details.",
    tone: "bg-muted text-muted-foreground",
  },
};

export default async function TrackingPage({ params }: PageProps<"/track/[code]">) {
  const tracking = await lookUp((await params).code);
  if (!tracking) notFound();

  const progress = trackingProgress(
    tracking.status,
    tracking.timeline.map((event) => event.status),
  );

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-6 sm:py-10">
      <StatusCard tracking={tracking} progress={progress} />
      <HistoryCard timeline={tracking.timeline} />
      <p className="text-center text-xs text-muted-foreground">
        Times are shown in UTC.{" "}
        <Link href="/" className="underline underline-offset-4 hover:text-foreground">
          Track another shipment
        </Link>
      </p>
    </main>
  );
}

function StatusCard({
  tracking,
  progress,
}: {
  tracking: PublicTracking;
  progress: TrackingProgress;
}) {
  const copy = STATUS_COPY[tracking.status];
  const Icon = copy.icon;
  const deliveredAt = tracking.timeline.findLast(
    (event) => event.status === "delivered",
  )?.occurredAt;

  return (
    <Card>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Tracking code{" "}
            <span className="font-mono font-medium text-foreground">{tracking.trackingCode}</span>
          </p>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-full",
                copy.tone,
              )}
            >
              <Icon className="size-6" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight" data-testid="tracking-status">
                {shipmentStatusLabel(tracking.status)}
              </h1>
              <p className="text-sm text-muted-foreground">{copy.text}</p>
            </div>
          </div>
        </div>

        {progress.state !== "cancelled" && <ProgressSteps progress={progress} />}

        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">Route</dt>
            <dd className="flex flex-col">
              <span>{formatPlace(tracking.origin.city, tracking.origin.country)}</span>
              <ArrowDownIcon className="my-0.5 size-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">to</span>
              <span>{formatPlace(tracking.destination.city, tracking.destination.country)}</span>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            {deliveredAt ? (
              <>
                <dt className="text-muted-foreground">Delivered</dt>
                <dd>{formatDateTime(deliveredAt)}</dd>
              </>
            ) : (
              <>
                <dt className="text-muted-foreground">Expected delivery</dt>
                <dd className="flex items-center gap-1.5">
                  <CalendarClockIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  {tracking.promisedDeliveryAt && tracking.status !== "cancelled"
                    ? formatDate(tracking.promisedDeliveryAt)
                    : "Not yet scheduled"}
                </dd>
              </>
            )}
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

/** The normal delivery path as five steps; an exception colours the reached steps amber. */
function ProgressSteps({ progress }: { progress: TrackingProgress }) {
  const reachedTone = progress.state === "exception" ? "bg-amber-500" : "bg-primary";
  return (
    <ol aria-label="Delivery progress" className="grid grid-cols-5 gap-1.5">
      {DELIVERY_STEPS.map((step, index) => {
        const reached = index <= progress.stepIndex;
        const current = index === progress.stepIndex;
        return (
          <li
            key={step}
            aria-current={current ? "step" : undefined}
            className="flex flex-col gap-1.5"
          >
            <span
              aria-hidden="true"
              className={cn("h-1.5 rounded-full", reached ? reachedTone : "bg-foreground/10")}
            />
            <span
              className={cn(
                "text-[11px] leading-tight sm:text-xs",
                current ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {shipmentStatusLabel(step)}
              {reached && !current && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function HistoryCard({ timeline }: { timeline: PublicTracking["timeline"] }) {
  const newestFirst = [...timeline].reverse();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Shipment history</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Timeline aria-label="Shipment history">
          {newestFirst.map((event, index) => (
            <TimelineItem
              key={`${event.occurredAt.toISOString()}-${index}`}
              highlighted={index === 0}
            >
              <div className="flex flex-col gap-0.5 text-sm">
                <span className="font-medium">{shipmentEventTitle(event.type, event.status)}</span>
                <span className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
                  <time dateTime={event.occurredAt.toISOString()}>
                    {formatDateTime(event.occurredAt)}
                  </time>
                  {event.city && (
                    <>
                      <span aria-hidden="true">·</span>
                      <MapPinIcon className="size-3.5" aria-hidden="true" />
                      {event.city}
                    </>
                  )}
                </span>
                {event.publicNote && <p className="mt-1">{event.publicNote}</p>}
              </div>
            </TimelineItem>
          ))}
        </Timeline>
      </CardContent>
    </Card>
  );
}
