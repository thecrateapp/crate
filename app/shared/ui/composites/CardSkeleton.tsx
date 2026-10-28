import { Skeleton } from "@crate/ui/shadcn/skeleton";

export function CardSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      data-slot="skeleton-card"
      className="crate-skeleton-card"
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        <Skeleton className="mb-2 h-8 w-20" />
        <Skeleton className="h-4 w-16" />
      </div>
    </div>
  );
}
