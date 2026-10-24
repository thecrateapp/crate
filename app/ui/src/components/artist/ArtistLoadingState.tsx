import { Skeleton } from "@crate/ui/shadcn/skeleton";

const ACTION_SKELETON_KEYS = Array.from(
  { length: 6 },
  (_, index) => `artist-action-skeleton-${index}`,
);
const ALBUM_SKELETON_KEYS = Array.from(
  { length: 8 },
  (_, index) => `artist-album-skeleton-${index}`,
);

export function ArtistLoadingState() {
  return (
    <div className="min-w-0 space-y-4">
      <div className="min-h-hero-md bg-surface-object" />
      <div className="min-w-0">
        <div className="mb-6 flex flex-wrap gap-2">
          {ACTION_SKELETON_KEYS.map((key) => (
            <Skeleton key={key} className="size-11" />
          ))}
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
          {ALBUM_SKELETON_KEYS.map((key) => (
            <div key={key} className="min-w-0">
              <Skeleton className="w-full aspect-square rounded-md mb-2" />
              <Skeleton className="h-4 w-3/4 mb-1" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
