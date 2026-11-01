import { CircleCheckIcon, CircleXIcon, MailXIcon } from "lucide-react";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { describeUnsubscribeToken } from "@/server/services/email-notifications";

import { unsubscribeAction } from "./actions";

/** The link is personal (it names an address): keep it out of search engines. */
export const metadata: Metadata = {
  title: "Email notifications",
  robots: { index: false, follow: false },
};

/**
 * Where "Stop these emails" in a notification leads. A GET only shows what would happen: opting
 * out is a button (a POST), so link scanners and mail clients that prefetch URLs cannot
 * unsubscribe anyone by accident.
 */
export default async function UnsubscribePage({ params }: PageProps<"/unsubscribe/[token]">) {
  const { token } = await params;
  const target = await describeUnsubscribeToken(token);

  if (!target) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CircleXIcon className="size-8 text-destructive" aria-hidden="true" />
            <CardTitle>
              <h1>This link does not work</h1>
            </CardTitle>
            <CardDescription>
              It may have been copied incompletely. Use the link in the latest email you received,
              or ask the company that sent it to stop the emails.
            </CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  if (target.optedOut) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CircleCheckIcon className="size-8 text-emerald-600" aria-hidden="true" />
            <CardTitle>
              <h1 data-testid="unsubscribed">You are unsubscribed</h1>
            </CardTitle>
            <CardDescription>
              {target.organizationName} will no longer send shipment emails to {target.maskedEmail}.
              You can still follow any shipment with its tracking code.
            </CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <CardHeader>
          <MailXIcon className="size-8 text-muted-foreground" aria-hidden="true" />
          <CardTitle>
            <h1>Stop shipment emails?</h1>
          </CardTitle>
          <CardDescription>
            {target.organizationName} sends an email to {target.maskedEmail} when a shipment is
            picked up, out for delivery, delivered or has a problem. This stops those emails for all
            your shipments with them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={unsubscribeAction}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit">Stop these emails</Button>
          </form>
        </CardContent>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-md px-4 py-6 sm:py-10">{children}</main>;
}
