import { Skeleton } from "@/components/ui/skeleton";

export default function WebhooksLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
