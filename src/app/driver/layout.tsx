import { Suspense } from "react";

import { LiveIndicator } from "@/components/realtime/live-indicator";
import { RealtimeProvider } from "@/components/realtime/realtime-provider";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentUser, requireAuthContextOn } from "@/server/auth/session";

import { signOutAction } from "../(auth)/actions";

/**
 * The driver app: a narrow, phone-first column. As in the dashboard, the session is read inside
 * <Suspense> and every page repeats the check (`requireAuthContextOn("/driver")`), which also
 * sends staff back to the dashboard. The realtime connection lives here, across client navigations.
 */
export default function DriverLayout({ children }: LayoutProps<"/driver">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <DriverShell>{children}</DriverShell>
    </Suspense>
  );
}

async function DriverShell({ children }: { children: React.ReactNode }) {
  await requireAuthContextOn("/driver");
  const user = await getCurrentUser();

  return (
    <RealtimeProvider>
      <div className="flex flex-1 flex-col bg-muted/40">
        <SiteHeader>
          <LiveIndicator />
          <span className="hidden text-muted-foreground sm:inline">{user?.name} · Driver</span>
          <form action={signOutAction}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </SiteHeader>
        <div className="mx-auto w-full max-w-xl flex-1 px-4 py-6">{children}</div>
      </div>
    </RealtimeProvider>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="h-14 border-b" />
      <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}
