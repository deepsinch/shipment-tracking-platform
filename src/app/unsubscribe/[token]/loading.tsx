import { Skeleton } from "@/components/ui/skeleton";

export default function UnsubscribeLoading() {
  return (
    <div
      className="mx-auto w-full max-w-md space-y-4 px-4 py-10"
      aria-busy="true"
      aria-label="Loading"
    >
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}
