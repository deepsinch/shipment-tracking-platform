import { Suspense } from "react";

import { ROLE_LABELS } from "@/domain/roles";
import { getCurrentUser, requireAuthContext } from "@/server/auth/session";

import { signOutAction } from "../(auth)/actions";

/**
 * The session read happens inside <Suspense> (Cache Components rule). Children render only after
 * the auth check passes. Pages still call requireAuthContext() themselves: a layout does not
 * re-render on every client navigation, so it is not the only guard.
 */
export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <Suspense fallback={<p className="p-4">Loading…</p>}>
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}

async function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const context = await requireAuthContext();
  const user = await getCurrentUser();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="font-semibold">Waybill</span>
        <div className="flex items-center gap-3 text-sm">
          <span>
            {user?.name} · {ROLE_LABELS[context.role]}
          </span>
          <form action={signOutAction}>
            <button type="submit" className="underline">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <div className="flex-1 p-4">{children}</div>
    </div>
  );
}
