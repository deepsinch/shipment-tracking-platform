"use client";

import { cn } from "@/lib/utils";

import { useRealtimeStatus } from "./realtime-provider";

const LABELS = {
  connecting: { short: "Connecting…", full: "Connecting to live updates" },
  live: { short: "Live", full: "Live updates on" },
  reconnecting: { short: "Reconnecting…", full: "Live updates interrupted, reconnecting" },
} as const;

/**
 * A small status pill for the realtime connection. The dot's colour is backed by text, and the
 * full wording is a polite live region, so screen reader users hear when updates stop and resume.
 */
export function LiveIndicator({ className }: { className?: string }) {
  const status = useRealtimeStatus();
  const label = LABELS[status];

  return (
    <span
      role="status"
      data-testid="live-indicator"
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        status === "live" ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full",
          status === "live" && "bg-emerald-600",
          status === "connecting" && "bg-muted-foreground/60",
          status === "reconnecting" && "animate-pulse bg-amber-500",
        )}
      />
      <span aria-hidden="true">{label.short}</span>
      <span className="sr-only">{label.full}</span>
    </span>
  );
}
