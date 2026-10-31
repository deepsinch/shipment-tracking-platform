import { Skeleton } from "@/components/ui/skeleton";

export default function TrackingLoading() {
  return (
    <div
      className="mx-auto w-full max-w-xl space-y-4 px-4 py-6 sm:py-10"
      aria-busy="true"
      aria-label="Loading"
    >
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-80 w-full rounded-xl" />
    </div>
  );
}
