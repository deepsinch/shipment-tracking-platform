import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { canViewEmailPreviews } from "@/domain/email";
import { formatDateTime } from "@/lib/format";
import { requireAuthContextOn } from "@/server/auth/session";
import { env } from "@/server/env";
import {
  EMAIL_PREVIEW_LIMIT,
  listEmailPreviews,
  type EmailPreview,
} from "@/server/services/email-notifications";

export const metadata: Metadata = { title: "Email previews" };

export default async function EmailPreviewsPage() {
  const ctx = await requireAuthContextOn("/dashboard");
  // Admins only (the previews hold customers' addresses); anyone else typing the URL goes back.
  if (!canViewEmailPreviews(ctx.role)) redirect("/dashboard/shipments");
  const result = await listEmailPreviews(ctx);
  if (!result.ok) redirect("/dashboard/shipments");
  const sendsForReal = env.email.transport === "resend";

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
        <h1 className="text-2xl font-semibold tracking-tight">Email previews</h1>
        <p className="text-sm text-muted-foreground" data-testid="email-mode">
          {sendsForReal
            ? "Customer emails are sent through Resend. Messages sent before it was switched on, or while it was off, are listed here as previews only."
            : "Nothing is sent: this deployment has no email provider set up (or is in demo mode), so each customer email is stored here exactly as it would have been sent."}{" "}
          Times are in UTC.
        </p>
      </div>

      {result.previews.length === 0 ? (
        <Card className="items-center px-6 py-10 text-center">
          <p className="font-medium">No previews yet</p>
          <p className="text-sm text-muted-foreground">
            Move a shipment that has a recipient email to Picked up, Out for delivery, Delivered or
            Exception, and its email appears here.
          </p>
        </Card>
      ) : (
        <section aria-label="Messages" className="flex flex-col gap-3">
          {result.previews.map((preview) => (
            <PreviewCard key={preview.id} preview={preview} />
          ))}
          {result.previews.length === EMAIL_PREVIEW_LIMIT && (
            <p className="text-xs text-muted-foreground">
              Showing the latest {EMAIL_PREVIEW_LIMIT}.
            </p>
          )}
        </section>
      )}
    </main>
  );
}

/**
 * The text version, as text. The HTML version is stored and sent, but showing it would mean
 * rendering stored markup in the dashboard (or a sandboxed frame, which the CSP's `frame-src`
 * would need loosening for); the text carries the same content and cannot run anything.
 */
function PreviewCard({ preview }: { preview: EmailPreview }) {
  return (
    <Card data-testid="email-preview">
      <CardHeader className="gap-1">
        <CardTitle className="text-base">{preview.subject}</CardTitle>
        <p className="text-sm text-muted-foreground">
          To <span className="font-mono break-all">{preview.recipient}</span> ·{" "}
          {formatDateTime(preview.createdAt)} ·{" "}
          <Link
            href={`/dashboard/shipments/${preview.shipmentId}`}
            className="underline underline-offset-4"
          >
            {preview.trackingCode}
          </Link>
        </p>
      </CardHeader>
      <CardContent>
        <pre
          data-testid="email-preview-text"
          className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap"
        >
          {preview.textBody}
        </pre>
      </CardContent>
    </Card>
  );
}
