import { cn } from "@crate/ui/lib/cn";
import { Skeleton } from "@crate/ui/shadcn/skeleton";
import {
  MEDIA_GRID_BASE_CLASS_NAME,
  MEDIA_GRID_DENSITY_CLASS_NAME,
  MEDIA_RAIL_BASE_CLASS_NAME,
  MEDIA_RAIL_COLUMNS_CLASS_NAME,
  type MediaGridDensity,
} from "@crate/ui/lib/media-layout";

interface GridSkeletonProps {
  count?: number;
  columns?: string;
  density?: MediaGridDensity;
  label?: string;
  variant?: "album" | "artist" | "artist-fill" | "station";
  layout?: "grid" | "rail";
  className?: string;
}

export function GridSkeleton({
  count = 12,
  columns,
  density,
  label = "Loading",
  variant,
  layout = "grid",
  className,
}: GridSkeletonProps) {
  const announcement = <span className="sr-only">{label}</span>;
  const cards = Array.from({ length: count }, (_, index) => (
    <div
      key={index}
      data-slot="skeleton-cover"
      data-variant={variant}
      aria-hidden="true"
      className="crate-skeleton-media"
    >
      <Skeleton className="crate-skeleton-media-cover" />
      {variant !== "station" ? (
        <>
          <p className="m-0 h-5 text-sm text-text-muted">—</p>
          <p className="m-0 h-4 font-mono text-label text-text-subtle">—</p>
        </>
      ) : null}
    </div>
  ));
  if (layout === "rail")
    return (
      <div role="status" aria-label={label} data-slot="skeleton-rail">
        {announcement}
        <div
          data-testid="media-rail"
          data-rail-fit="columns"
          className={cn(
            MEDIA_RAIL_BASE_CLASS_NAME,
            MEDIA_RAIL_COLUMNS_CLASS_NAME,
            className,
          )}
        >
          {cards}
        </div>
      </div>
    );
  if (density)
    return (
      <div
        role="status"
        aria-label={label}
        data-testid="media-grid"
        data-density={density}
        className={cn(
          MEDIA_GRID_BASE_CLASS_NAME,
          MEDIA_GRID_DENSITY_CLASS_NAME[density],
          className,
        )}
      >
        {announcement}
        {cards}
      </div>
    );

  return (
    <div
      role="status"
      aria-label={label}
      className={cn(
        "grid gap-4",
        columns ?? "grid-cols-[repeat(auto-fill,minmax(200px,1fr))]",
        className,
      )}
    >
      {announcement}
      {cards}
    </div>
  );
}
