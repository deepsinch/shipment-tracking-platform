import { Skeleton } from "@/components/ui/skeleton";

export default function DriverShipmentLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}
