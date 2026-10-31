import { MapIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The box a map renders into. It has its own size, so the page does not shift while MapLibre
 * loads, and a neutral background close to the basemap's colour.
 */
export function MapFrame({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("relative isolate overflow-hidden rounded-xl border bg-[#eef0f3]", className)}
    >
      {children}
    </div>
  );
}

/** Shown while the map's code loads. */
export function MapLoading() {
  return (
    <div className="absolute inset-0 grid place-items-center" aria-hidden="true">
      <MapIcon className="size-8 animate-pulse text-slate-400 motion-reduce:animate-none" />
    </div>
  );
}

/** Shown when the browser cannot draw the map (no WebGL). The text beside it says the same. */
export function MapUnavailable() {
  return (
    <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-600">
      The map cannot be shown in this browser. Everything on it is listed as text.
    </div>
  );
}
