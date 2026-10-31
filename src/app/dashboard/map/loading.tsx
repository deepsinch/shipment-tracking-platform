import { Skeleton } from "@/components/ui/skeleton";

export default function MapLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-[55vh] min-h-80 lg:h-[calc(100dvh-15rem)]" />
        <Skeleton className="h-64 lg:h-[calc(100dvh-15rem)]" />
      </div>
    </div>
  );
}
