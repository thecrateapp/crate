import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Loader2 } from "@crate/ui/icons";

import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import type { SearchResults } from "./explore-model";

export {
  DecadeDetailView,
  GenreDetailView,
  PlaylistCategoryView,
} from "./ExploreDetailViews";

export function ExplorePill({
  label,
  count,
  onClick,
}: {
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-border-quiet px-4 py-2 transition-colors hover:border-accent-action/40 hover:bg-accent-action/5"
    >
      <span className="text-sm font-medium text-accent-action">{label}</span>
      {count != null && count > 0 ? (
        <span className="text-xs text-text-muted">{count}</span>
      ) : null}
    </button>
  );
}

export function ExploreSectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-bold text-text-primary">{title}</h2>
        {subtitle ? (
          <p className="mt-1 text-sm text-text-muted">{subtitle}</p>
        ) : null}
      </div>
      {actionLabel && onAction ? (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-primary"
        >
          {actionLabel}
          <ArrowRight size={15} />
        </button>
      ) : null}
    </div>
  );
}

export function ExploreSectionRail({ children }: { children: ReactNode }) {
  return (
    <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}

export function ExploreLoadingState() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 size={24} className="animate-spin text-accent-action" />
    </div>
  );
}

export function SearchResultsView({ results }: { results: SearchResults }) {
  const { t } = useTranslation();
  const hasArtists = results.artists.length > 0;
  const hasAlbums = results.albums.length > 0;
  const hasTracks = results.tracks.length > 0;
  const trackRows = useMemo<TrackRowData[]>(
    () =>
      results.tracks.slice(0, 10).map((track) => ({
        ...track,
        path: track.path || "",
        duration: track.duration || 0,
        library_track_id: track.id,
      })),
    [results.tracks],
  );

  if (!hasArtists && !hasAlbums && !hasTracks) {
    return (
      <p className="mt-8 text-sm text-text-muted">
        {t("explore.search.noResults")}
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {hasArtists ? (
        <div className="space-y-3">
          <h2 className="px-1 text-lg font-bold">
            {t("nav.collection.artists")}
          </h2>
          <ExploreSectionRail>
            {results.artists.map((artist) => (
              <ArtistCard
                key={artist.id ?? artist.name}
                name={artist.name}
                artistId={artist.id}
                artistSlug={artist.slug}
                subtitle={
                  artist.album_count
                    ? t("common.albumCountLabel", {
                        count: artist.album_count,
                      })
                    : undefined
                }
              />
            ))}
          </ExploreSectionRail>
        </div>
      ) : null}

      {hasAlbums ? (
        <div className="space-y-3">
          <h2 className="px-1 text-lg font-bold">
            {t("nav.collection.albums")}
          </h2>
          <ExploreSectionRail>
            {results.albums.map((album) => (
              <AlbumCard
                key={album.id || `${album.artist}-${album.name}`}
                artist={album.artist}
                album={album.name}
                albumId={album.id}
                albumSlug={album.slug}
                year={album.year}
              />
            ))}
          </ExploreSectionRail>
        </div>
      ) : null}

      {hasTracks ? (
        <div className="space-y-3">
          <h2 className="px-1 text-lg font-bold">{t("common.tracks")}</h2>
          <div className="rounded-xl border border-border-quiet bg-surface-quiet-subtle">
            {trackRows.map((row, index) => (
              <TrackRow
                key={
                  row.id ??
                  row.global_track_uid ??
                  row.entity_uid ??
                  row.path ??
                  [row.artist, row.album, row.title].join(":")
                }
                track={row}
                index={index + 1}
                showArtist
                showAlbum
                queueTracks={trackRows}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
