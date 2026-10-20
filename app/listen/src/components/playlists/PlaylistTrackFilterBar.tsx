import { useTranslation } from "react-i18next";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { FilterBar } from "@crate/ui/domain/filters/FilterBar";

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
    <FilterBar
      className={className}
      search={
        <SearchInput
          value={query}
          onValueChange={onQueryChange}
          label={t("playlist.filter.placeholder")}
          placeholder={t("playlist.filter.placeholder")}
          clearLabel={t("playlist.filter.clear")}
        />
      }
      actions={
        <MonoLabel>
          {countLabel} {t("playlist.filter.tracks")}
        </MonoLabel>
      }
    />
  );
}
