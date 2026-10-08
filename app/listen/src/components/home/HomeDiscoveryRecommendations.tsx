import { useTranslation } from "react-i18next";

import { ArtistCard } from "@/components/cards/ArtistCard";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { CoreTracksPlaylistCard } from "@/components/home/CoreTracksPlaylistCard";
import { MediaRail, SectionHeader } from "@crate/ui/domain/lists";

import type {
  HomeDiscoveryPayload,
  HomeGeneratedPlaylistSummary,
  HomeSectionId,
} from "./home-model";

function chunkItems<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function RecommendedTracksSection({
  tracks,
  onViewAll,
}: {
  tracks: TrackRowData[];
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  const pages = chunkItems(tracks, 9);
  if (!tracks.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.recommendedTracks.title")}
        subtitle={t("home.sections.recommendedTracks.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("recommended-tracks")}
      />
      <MediaRail>
        {pages.map((pageTracks, pageIndex) => (
          <div
            key={`recommended-page-${pageIndex}`}
            className="w-full min-w-0 snap-start"
          >
            <div className="grid gap-2 xl:grid-cols-3">
              {pageTracks.map((track) => (
                <TrackRow
                  key={
                    track.library_track_id ??
                    track.global_track_uid ??
                    track.entity_uid ??
                    track.path ??
                    [track.artist, track.album, track.title].join(":")
                  }
                  track={track}
                  showArtist
                  showAlbum
                  showCoverThumb
                  queueTracks={pageTracks}
                />
              ))}
            </div>
          </div>
        ))}
      </MediaRail>
    </section>
  );
}

export function FavoriteArtistsSection({
  artists,
  onViewAll,
}: {
  artists: HomeDiscoveryPayload["favorite_artists"];
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  if (!artists.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.favoriteArtists.title")}
        subtitle={t("home.sections.favoriteArtists.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("favorite-artists")}
      />
      <MediaRail fit="columns">
        {artists.map((artist) => (
          <ArtistCard
            key={
              artist.global_artist_uid ?? artist.artist_id ?? artist.artist_name
            }
            name={artist.artist_name}
            artistId={artist.artist_id}
            globalArtistUid={artist.global_artist_uid}
            artistEntityUid={artist.artist_entity_uid}
            artistSlug={artist.artist_slug}
            subtitle={t("common.playCount", { count: artist.play_count })}
            layout="grid"
            fillGrid
          />
        ))}
      </MediaRail>
    </section>
  );
}

export function EssentialsSection({
  items,
  onOpenPlaylist,
  onPlayPlaylist,
  onShufflePlaylist,
  onStartRadio,
  onViewAll,
}: {
  items: HomeGeneratedPlaylistSummary[];
  onOpenPlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onPlayPlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onShufflePlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onStartRadio: (item: HomeGeneratedPlaylistSummary) => void;
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  if (!items.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.artistSets.title")}
        subtitle={t("home.sections.artistSets.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("core-tracks")}
      />
      <MediaRail fit="columns">
        {items.map((item) => (
          <CoreTracksPlaylistCard
            key={item.id}
            item={item}
            onOpenPlaylist={onOpenPlaylist}
            onPlayPlaylist={onPlayPlaylist}
            onShufflePlaylist={onShufflePlaylist}
            onStartRadio={onStartRadio}
          />
        ))}
      </MediaRail>
    </section>
  );
}
