import Link from "next/link";
import { Suspense } from "react";

import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROLE_LABELS } from "@/domain/roles";
import { getCurrentUser, requireAuthContextOn } from "@/server/auth/session";

import { signOutAction } from "../(auth)/actions";

/**
 * The session read happens inside <Suspense> (Cache Components rule). Children render only after
 * the auth check passes; drivers are sent to the driver app. Pages run the same check themselves
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

  return (
    <div className="flex flex-1 flex-col bg-muted/40">
      <SiteHeader>
        <nav aria-label="Dashboard" className="hidden sm:block">
          <Button asChild variant="ghost">
            <Link href="/dashboard/shipments">Shipments</Link>
          </Button>
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
