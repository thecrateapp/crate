import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, X } from "@crate/ui/icons";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { SearchInput } from "@crate/ui/primitives/SearchInput";

import { cn } from "@/lib/utils";

interface FilterablePlaylistTrack {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
}

function normalizeFilterQuery(value: string): string[] {
  return value.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

export function filterPlaylistTracks<T extends FilterablePlaylistTrack>(
  tracks: T[],
  query: string,
): T[] {
  const terms = normalizeFilterQuery(query);
  if (!terms.length) return tracks;

  return tracks.filter((track) => {
    const haystack = `${track.title || ""} ${track.artist || ""} ${
      track.album || ""
    }`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function PlaylistTrackFilterBar({
  query,
  onQueryChange,
  totalCount,
  filteredCount,
  className,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  totalCount: number;
  filteredCount: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const filtering = query.trim().length > 0;
  const countLabel = filtering
    ? t("playlist.filter.filteredCount", {
        filtered: filteredCount,
        total: totalCount,
      })
    : `${totalCount}`;

  return (
    <div className={cn("flex w-full", className)}>
      <div className="relative min-w-0 flex-1">
        <SearchInput
          value={query}
          onValueChange={onQueryChange}
          clearable={false}
          label={t("playlist.filter.placeholder")}
          placeholder={t("playlist.filter.placeholder")}
          className="rounded-lg bg-surface-canvas/10 pr-28 placeholder:text-text-muted sm:pr-36 md:text-base"
        />
        <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium uppercase tracking-[0.18em] text-accent-action/85">
          {countLabel}
          <span className="ml-1 text-accent-action/65">
            {t("playlist.filter.tracks")}
          </span>
        </div>
        {filtering ? (
          <IconButton
            label={t("playlist.filter.clear")}
            size="sm"
            onClick={() => onQueryChange("")}
            className="absolute top-1/2 right-24 size-7 -translate-y-1/2 hover:-translate-y-1/2 sm:right-32"
          >
            <X size={CRATE_ICON_SIZE.xs} />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}
