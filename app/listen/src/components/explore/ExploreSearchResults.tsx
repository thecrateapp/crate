import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { MediaRail, SectionHeader } from "@crate/ui/domain/lists";
import { EmptyState } from "@crate/ui/domain/states";

import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";

import type { SearchResults } from "./explore-model";

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
      <EmptyState variant="inline" message={t("explore.search.noResults")} />
    );
  }

  return (
    <div className="space-y-8">
      {hasArtists ? (
        <div className="space-y-3">
          <SectionHeader className="px-1" title={t("nav.collection.artists")} />
          <MediaRail>
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
          </MediaRail>
        </div>
      ) : null}

      {hasAlbums ? (
        <div className="space-y-3">
          <SectionHeader className="px-1" title={t("nav.collection.albums")} />
          <MediaRail>
            {results.albums.map((album) => (
              <AlbumCard
                key={album.id || `${album.artist}-${album.name}`}
                layout="rail"
                artist={album.artist}
                album={album.name}
                albumId={album.id}
                albumEntityUid={album.entity_uid}
                artistEntityUid={album.artist_entity_uid}
                albumSlug={album.slug}
                artistSlug={album.artist_slug}
                year={album.year}
              />
            ))}
          </MediaRail>
        </div>
      ) : null}

      {hasTracks ? (
        <div className="space-y-3">
          <SectionHeader className="px-1" title={t("common.tracks")} />
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
