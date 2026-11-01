import Link from "next/link";
import { Suspense } from "react";

import { LiveIndicator } from "@/components/realtime/live-indicator";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { canManageApiKeys } from "@/domain/api-keys";
import { ROLE_LABELS } from "@/domain/roles";
import { canManageWebhooks } from "@/domain/webhooks";
import { getCurrentUser, requireAuthContextOn } from "@/server/auth/session";
import { drainWebhooksOnActivity } from "@/server/webhooks/schedule";

import { signOutAction } from "../(auth)/actions";

/**
 * The session read happens inside <Suspense> (Cache Components rule). Children render only after
 * the auth check passes; drivers are sent to the driver app. The realtime connection lives here, so
 * it stays open across client navigations between dashboard pages. Pages run the same check themselves
 * (`requireAuthContextOn`): a layout does not re-render on every client navigation, so it is not
 * the only guard.
 */
export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}

async function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const context = await requireAuthContextOn("/dashboard");
  const user = await getCurrentUser();
  // Staff opening the dashboard doubles as the heartbeat that retries due webhooks (throttled).
  drainWebhooksOnActivity();

  return (
    <RealtimeProvider>
      <div className="flex flex-1 flex-col bg-muted/40">
        <SiteHeader>
          <LiveIndicator />
          <nav aria-label="Dashboard" className="hidden sm:block">
            <Button asChild variant="ghost">
              <Link href="/dashboard/shipments">Shipments</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/dashboard/map">Live map</Link>
            </Button>
            {canManageApiKeys(context.role) && (
              <Button asChild variant="ghost">
                <Link href="/dashboard/settings/api-keys">API keys</Link>
              </Button>
            )}
            {canManageWebhooks(context.role) && (
              <Button asChild variant="ghost">
                <Link href="/dashboard/settings/webhooks">Webhooks</Link>
              </Button>
            )}
          </nav>
          <span className="hidden text-muted-foreground md:inline">
            {user?.name} · {ROLE_LABELS[context.role]}
          </span>
          <form action={signOutAction}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </SiteHeader>
        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</div>
      </div>
    </RealtimeProvider>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="h-14 border-b" />
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
