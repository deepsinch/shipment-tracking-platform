import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EMAIL_DISPLAY_LABELS, type EmailDisplayStatus } from "@/domain/email";
import { formatDateTime } from "@/lib/format";
import type { ShipmentEmailStatus } from "@/server/services/email-notifications";

const BADGE: Record<EmailDisplayStatus, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "outline",
  sent: "default",
  preview: "secondary",
  failed: "destructive",
  opted_out: "outline",
};

/**
 * Whether the customer is emailed about this shipment, and how each message went. Status only:
 * what the messages say is under Settings, Email previews (admins).
 */
export function EmailNotifications({ status }: { status: ShipmentEmailStatus }) {
  return (
    <Card data-testid="email-notifications">
      <CardHeader>
        <CardTitle>
          <h2>Customer emails</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {!status.recipient ? (
          <p className="text-muted-foreground">
            No recipient email on this shipment, so the customer is not emailed.
          </p>
        ) : (
          <p className="text-muted-foreground">
            Updates go to <span className="font-mono break-all">{status.recipient}</span> when the
            shipment is picked up, out for delivery, delivered or has an exception.
          </p>
        )}
        {status.optedOut && (
          <p data-testid="email-opted-out" className="flex items-center gap-2">
            <Badge variant="outline">{EMAIL_DISPLAY_LABELS.opted_out}</Badge>
            <span className="text-muted-foreground">The customer asked to stop these emails.</span>
          </p>
        )}
        {status.messages.length > 0 && (
          <ul className="flex flex-col gap-2">
            {status.messages.map((message) => (
              <li
                key={message.id}
                data-testid="email-message"
                data-status={message.status}
                className="flex flex-wrap items-center gap-x-2 gap-y-1"
              >
                <Badge variant={BADGE[message.status]}>
                  {EMAIL_DISPLAY_LABELS[message.status]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(message.createdAt)}
                </span>
                {message.lastError && message.status !== "sent" && (
                  <span className="text-xs break-words text-muted-foreground">
                    {message.lastError}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
