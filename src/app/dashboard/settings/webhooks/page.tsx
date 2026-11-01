import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  canManageWebhooks,
  canResend,
  DISABLED_REASON_LABELS,
  WEBHOOK_EVENT_LABELS,
  type DeliveryStatus,
} from "@/domain/webhooks";
import { formatDateTime } from "@/lib/format";
import { requireAuthContextOn } from "@/server/auth/session";
import {
  DELIVERY_LOG_LENGTH,
  listWebhookEndpoints,
  type WebhookDeliverySummary,
  type WebhookEndpointSummary,
} from "@/server/services/webhook-endpoints";

import { CreateWebhookForm } from "./create-webhook-form";
import { EndpointControls } from "./endpoint-controls";
import { ResendButton } from "./resend-button";

export const metadata: Metadata = { title: "Webhooks" };

export default async function WebhooksPage() {
  const ctx = await requireAuthContextOn("/dashboard");
  // Only admins manage webhooks (the service would answer `forbidden`); anyone else typing the
  // URL is sent back to the shipments.
  if (!canManageWebhooks(ctx.role)) redirect("/dashboard/shipments");
  const result = await listWebhookEndpoints(ctx);
  if (!result.ok) redirect("/dashboard/shipments");

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/dashboard/shipments"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          Shipments
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Webhooks</h1>
        <p className="text-sm text-muted-foreground">
          Get a signed request at your own URL when a shipment is booked, changes status or gets a
          driver. Failed deliveries are retried for about nine hours, and times below are in UTC.
          Check the signature with the secret shown when you add the webhook.
        </p>
      </div>

      <CreateWebhookForm />
      <EndpointList endpoints={result.endpoints} />
    </main>
  );
}

function EndpointList({
  endpoints,
}: {
  endpoints: (WebhookEndpointSummary & { deliveries: WebhookDeliverySummary[] })[];
}) {
  return (
    <section aria-labelledby="endpoints-heading" className="flex flex-col gap-3">
      <h2 id="endpoints-heading" className="text-lg font-semibold tracking-tight">
        Your webhooks
      </h2>
      {endpoints.length === 0 ? (
        <Card className="items-center px-6 py-10 text-center">
          <p className="font-medium">No webhooks yet</p>
          <p className="text-sm text-muted-foreground">Add one above to get started.</p>
        </Card>
      ) : (
        endpoints.map((endpoint) => <EndpointCard key={endpoint.id} endpoint={endpoint} />)
      )}
    </section>
  );
}

function EndpointCard({
  endpoint,
}: {
  endpoint: WebhookEndpointSummary & { deliveries: WebhookDeliverySummary[] };
}) {
  return (
    <Card data-testid="webhook-endpoint">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="font-mono text-sm leading-snug break-all">{endpoint.url}</CardTitle>
          {endpoint.enabled ? <Badge>Enabled</Badge> : <Badge variant="outline">Disabled</Badge>}
        </div>
        <div className="flex flex-wrap gap-1">
          {endpoint.eventTypes.map((type) => (
            <Badge key={type} variant="secondary">
              {WEBHOOK_EVENT_LABELS[type].label}
            </Badge>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Added {formatDateTime(endpoint.createdAt)} by {endpoint.createdByName}
          {endpoint.disabledReason && ` · ${DISABLED_REASON_LABELS[endpoint.disabledReason]}`}
        </p>
        <EndpointControls endpointId={endpoint.id} url={endpoint.url} enabled={endpoint.enabled} />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Latest deliveries</h3>
        {endpoint.deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing sent yet. Deliveries appear here when a chosen event happens.
          </p>
        ) : (
          <DeliveryLog deliveries={endpoint.deliveries} />
        )}
      </CardContent>
    </Card>
  );
}

function DeliveryLog({ deliveries }: { deliveries: WebhookDeliverySummary[] }) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-3">Event</TableHead>
            <TableHead>Result</TableHead>
            <TableHead className="hidden sm:table-cell">Attempts</TableHead>
            <TableHead className="pr-3 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deliveries.map((delivery) => (
            <DeliveryRow key={delivery.id} delivery={delivery} />
          ))}
        </TableBody>
      </Table>
      {deliveries.length === DELIVERY_LOG_LENGTH && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Showing the latest {DELIVERY_LOG_LENGTH}.
        </p>
      )}
    </div>
  );
}

const STATUS_BADGES: Record<
  DeliveryStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  succeeded: { label: "Succeeded", variant: "default" },
  pending: { label: "Queued", variant: "outline" },
  failed: { label: "Retrying", variant: "secondary" },
  dead: { label: "Failed", variant: "destructive" },
};

function DeliveryRow({ delivery }: { delivery: WebhookDeliverySummary }) {
  const badge = STATUS_BADGES[delivery.status];
  const eventLabel = WEBHOOK_EVENT_LABELS[delivery.eventType].label;
  return (
    <TableRow data-testid="webhook-delivery" data-status={delivery.status}>
      <TableCell className="pl-3 whitespace-normal">
        <div className="font-medium">{eventLabel}</div>
        <div className="text-xs text-muted-foreground">{formatDateTime(delivery.createdAt)}</div>
      </TableCell>
      <TableCell className="whitespace-normal">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <div className="mt-1 text-xs text-muted-foreground">
          {delivery.lastStatusCode !== null &&
            (delivery.status === "succeeded" || !delivery.lastError) && (
              <span>HTTP {delivery.lastStatusCode}. </span>
            )}
          {delivery.status === "failed" && delivery.nextAttemptAt && (
            <span>Next try {formatDateTime(delivery.nextAttemptAt)}. </span>
          )}
          {delivery.lastError && delivery.status !== "succeeded" && (
            <span className="break-words">{delivery.lastError}</span>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden whitespace-normal sm:table-cell">{delivery.attempts}</TableCell>
      <TableCell className="pr-3 text-right whitespace-normal">
        {canResend(delivery.status) && (
          <ResendButton deliveryId={delivery.id} eventLabel={eventLabel} />
        )}
      </TableCell>
    </TableRow>
  );
}
