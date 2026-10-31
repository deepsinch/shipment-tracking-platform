"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { RealtimeClientEvent } from "@/lib/realtime-events";
import { createRefreshScheduler, type RefreshScheduler } from "@/lib/refresh-scheduler";
import { hasUnsavedInput } from "@/lib/unsaved-input";

import { useRealtime } from "./realtime-provider";

/** How long a burst of changes is collected into one refresh. */
const DEBOUNCE_MS = 300;

/**
 * Keeps a server-rendered page current: re-renders it (`router.refresh()`) when the realtime
 * stream says its data changed, and on every (re)connection, since changes made while
 * disconnected were not announced.
 *
 * - With `shipmentId`, only changes to that shipment count (a detail page); without it, any
 *   change the user may see (a list; the server already filtered the stream).
 * - Positions never refresh a page: they come every few seconds per shipment and are applied
 *   in place by the components that show them (`useLivePosition`).
 * - Bursts are collected into one refresh, and a refresh waits while a guarded form has unsaved
 *   input (see `createRefreshScheduler` and `UNSAVED_GUARD_ATTRIBUTE`), with a notice offering
 *   the latest data.
 * - `alsoOn` adds events of the caller's choosing (the live map refreshes for the first position
 *   of a shipment it does not know yet).
 * - Next hides, rather than unmounts, a page you navigate away from. While hidden it does not
 *   listen, so it refreshes when it is shown again.
 */
export function LiveRefresh({
  shipmentId,
  alsoOn,
}: {
  shipmentId?: string;
  alsoOn?: (event: RealtimeClientEvent) => boolean;
}) {
  const router = useRouter();
  const [deferred, setDeferred] = useState(false);
  const schedulerRef = useRef<RefreshScheduler | null>(null);
  const wasHidden = useRef(false);

  useEffect(() => {
    const scheduler = createRefreshScheduler({
      refresh: () => router.refresh(),
      isBlocked: () => hasUnsavedInput(document),
      onDeferredChange: setDeferred,
      debounceMs: DEBOUNCE_MS,
    });
    schedulerRef.current = scheduler;
    if (wasHidden.current) scheduler.request();

    const release = () => scheduler.release();
    const dismiss = () => scheduler.dismiss();
    document.addEventListener("input", release);
    document.addEventListener("reset", release);
    document.addEventListener("submit", dismiss);

    return () => {
      wasHidden.current = true;
      document.removeEventListener("input", release);
      document.removeEventListener("reset", release);
      document.removeEventListener("submit", dismiss);
      scheduler.dispose();
      schedulerRef.current = null;
      setDeferred(false);
    };
  }, [router]);

  useRealtime((event: RealtimeClientEvent) => {
    const relevant =
      event.kind === "resync" ||
      (event.kind === "shipment_changed" && (!shipmentId || event.shipmentId === shipmentId)) ||
      alsoOn?.(event) === true;
    if (relevant) schedulerRef.current?.request();
  });

  return (
    // Kept in the accessibility tree while empty (a live region must exist before it changes), but
    // out of the layout flow so it adds no gap. The notice itself is pinned to the bottom of the
    // viewport: the user is usually scrolled down to the form it is about, especially on a phone.
    <div role="status" className="empty:absolute">
      {deferred && (
        <div className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-xl flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-lg sm:flex-row sm:items-center sm:justify-between dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50">
          <p>
            This shipment was updated while you were editing. Your input is kept until you submit or
            load the latest version.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => schedulerRef.current?.refreshNow()}
          >
            Show latest
          </Button>
        </div>
      )}
    </div>
  );
}
