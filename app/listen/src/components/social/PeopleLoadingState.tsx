import { LoadingState } from "@crate/ui/domain/states";
import { Skeleton } from "@crate/ui/shadcn/skeleton";

export function PeopleLoadingState({ label }: { label: string }) {
  return (
    <LoadingState label={label}>
      <div className="grid gap-3">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            data-slot="skeleton-user-row"
            className="crate-skeleton-user-row"
          >
            <Skeleton className="crate-skeleton-avatar" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </LoadingState>
  );
}
