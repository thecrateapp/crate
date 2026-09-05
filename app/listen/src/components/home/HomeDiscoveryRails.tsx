import { useTranslation } from "react-i18next";
import { Play, Radio, Sparkles } from "@crate/ui/icons";

import {
  ItemActionMenu,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { usePlaylistActionEntries } from "@/components/actions/playlist-actions";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { CrateImage } from "@/components/artwork/CrateImage";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import { CoreTracksArtwork } from "@/components/home/CoreTracksArtwork";
import {
  SectionHeader,
  SectionRail,
  useSectionRail,
} from "@/components/home/HomeSections";
import { albumCoverApiUrl, artistPhotoApiUrl } from "@/lib/library-routes";
import { cn } from "@/lib/utils";

import type {
  HomeDiscoveryPayload,
  HomeGeneratedPlaylistSummary,
  HomeRadioStation,
  HomeSectionId,
} from "./home-model";

export { CustomMixCard, CustomMixesSection } from "./HomeCustomMixes";
export {
  SuggestedAlbumsSection,
  UpcomingAlbumsSection,
} from "./HomeAlbumRails";

function chunkItems<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function radioArtwork(station: HomeRadioStation): string | null {
  if (station.type === "album") {
    return (
      albumCoverApiUrl(
        {
          albumId: station.album_id,
          globalAlbumUid: station.global_album_uid,
          albumEntityUid: station.album_entity_uid,
          artistEntityUid: station.artist_entity_uid,
          albumSlug: station.album_slug,
          artistName: station.artist_name,
          albumName: station.album_name,
        },
        { size: 256 },
      ) || null
    );
  }
  return (
    artistPhotoApiUrl(
      {
        artistId: station.artist_id,
        globalArtistUid: station.global_artist_uid,
        artistEntityUid: station.artist_entity_uid,
        artistSlug: station.artist_slug,
        artistName: station.artist_name,
      },
      { size: 256 },
    ) || null
  );
}

function radioSeedTypeLabel(
  station: HomeRadioStation,
  labels: {
    track: string;
    album: string;
    genre: string;
    artist: string;
  },
): string {
  const seedType = station.seed_type ?? station.type;
  if (seedType === "track") return labels.track;
  if (seedType === "album") return labels.album;
  if (seedType === "genre") return labels.genre;
  return labels.artist;
}

function radioSeedLabel(station: HomeRadioStation): string {
  return (
    station.seed_label ||
    station.track_title ||
    station.album_name ||
    station.artist_name ||
    station.genre_name ||
    station.title.replace(/\s+Radio$/i, "")
  );
}

function radioSeedSubtitle(station: HomeRadioStation): string | null {
  return (
    station.seed_subtitle ||
    (station.type === "album" ? station.artist_name : null) ||
    (station.type === "track" ? station.artist_name : null) ||
    null
  );
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
  const rail = useSectionRail(pages.length);
  if (!tracks.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.recommendedTracks.title")}
        subtitle={t("home.sections.recommendedTracks.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("recommended-tracks")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef}>
        {pages.map((pageTracks, pageIndex) => (
          <div
            key={`recommended-page-${pageIndex}`}
            className="min-w-full snap-start"
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
      </SectionRail>
    </section>
  );
}

export function RadioStationCard({
  station,
  onPlay,
  layout = "rail",
}: {
  station: HomeRadioStation;
  onPlay: () => void;
  layout?: "rail" | "grid";
}) {
  const { t } = useTranslation();
  const artworkUrl = radioArtwork(station);
  const seedTypeLabel = radioSeedTypeLabel(station, {
    track: t("home.radio.track"),
    album: t("home.radio.album"),
    genre: t("home.radio.genre"),
    artist: t("home.radio.artist"),
  });
  const seedLabel = radioSeedLabel(station);
  const seedSubtitle = radioSeedSubtitle(station);

  return (
    <button
      onClick={onPlay}
      className={cn(
        "home-radio-card group relative overflow-hidden rounded-[12px] text-left",
        layout === "grid" ? "w-full min-w-0" : "w-full min-w-0 snap-start",
      )}
    >
      {artworkUrl ? (
        <CrateImage
          src={artworkUrl}
          alt=""
          className="aspect-square h-full w-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.04]"
        />
      ) : (
        <div className="aspect-square" />
      )}
      <div className="home-radio-overlay absolute inset-0" />
      <div className="home-radio-badge absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] backdrop-blur-md">
        <Radio size={12} className="inline-block" /> {seedTypeLabel}
      </div>
      <div className="absolute inset-x-0 bottom-0 p-4">
        <div className="home-radio-title truncate text-sm font-semibold">
          {seedLabel}
        </div>
        {seedSubtitle ? (
          <div className="home-radio-subtitle mt-1 line-clamp-2 text-xs leading-5">
            {seedSubtitle}
          </div>
        ) : null}
      </div>
    </button>
  );
}

export function RadioStationsSection({
  stations,
  onPlayStation,
  onViewAll,
}: {
  stations: HomeRadioStation[];
  onPlayStation: (station: HomeRadioStation) => void;
  onViewAll: (sectionId: HomeSectionId) => void;
}) {
  const { t } = useTranslation();
  const rail = useSectionRail(stations.length);
  if (!stations.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.radioStations.title")}
        subtitle={t("home.sections.radioStations.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("radio-stations")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef} fit="square-card">
        {stations.map((station) => (
          <RadioStationCard
            key={`${station.type}-${
              station.seed_value ??
              station.global_artist_uid ??
              station.global_album_uid ??
              station.artist_id ??
              station.album_id ??
              station.title
            }`}
            station={station}
            onPlay={() => onPlayStation(station)}
          />
        ))}
      </SectionRail>
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
  const rail = useSectionRail(artists.length);
  if (!artists.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.favoriteArtists.title")}
        subtitle={t("home.sections.favoriteArtists.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("favorite-artists")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef} fit="square-card">
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
      </SectionRail>
    </section>
  );
}

export function CoreTracksPlaylistCard({
  item,
  onOpenPlaylist,
  onPlayPlaylist,
  onShufflePlaylist,
  onStartRadio,
  layout = "rail",
}: {
  item: HomeGeneratedPlaylistSummary;
  onOpenPlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onPlayPlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onShufflePlaylist: (item: HomeGeneratedPlaylistSummary) => void;
  onStartRadio: (item: HomeGeneratedPlaylistSummary) => void;
  layout?: "rail" | "grid";
}) {
  const { t } = useTranslation();
  const href = `/home/playlist/${encodeURIComponent(item.id)}`;
  const actions = usePlaylistActionEntries({
    name: item.name,
    href,
    onPlay: () => onPlayPlaylist(item),
    onShuffle: () => onShufflePlaylist(item),
    onStartRadio: () => onStartRadio(item),
  });
  const actionMenu = useItemActionMenu(actions);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenPlaylist(item)}
      onKeyDown={(event) => {
        actionMenu.handleKeyboardTrigger(event);
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenPlaylist(item);
        }
      }}
      onContextMenu={actionMenu.handleContextMenu}
      {...actionMenu.longPressHandlers}
      className={cn(
        "group cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-action/40 focus-visible:rounded-xl",
        layout === "grid" ? "w-full min-w-0" : "w-full min-w-0 snap-start",
      )}
    >
      <div className="home-discovery-artwork relative mb-2 overflow-hidden rounded-xl">
        <CoreTracksArtwork
          item={item}
          className="aspect-square rounded-xl transition-transform group-hover:scale-[1.02]"
        />
        <div className="home-discovery-artwork-overlay absolute inset-0 flex items-center justify-center">
          <button
            className="home-discovery-play-button flex h-10 w-10 translate-y-2 items-center justify-center rounded-full opacity-0 shadow-lg transition-[transform,opacity] group-hover:translate-y-0 group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onPlayPlaylist(item);
            }}
          >
            <Play
              size={18}
              fill="currentColor"
              className="ml-0.5 text-accent-action-foreground"
            />
          </button>
        </div>
      </div>
      <ItemActionMenu
        actions={actions}
        header={{
          type: "media",
          title: item.name,
          subtitle: t("common.trackCount", { count: item.track_count }),
          imageShape: "square",
          fallbackIcon: Sparkles,
        }}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
    </div>
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
  const rail = useSectionRail(items.length);
  if (!items.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.sections.artistSets.title")}
        subtitle={t("home.sections.artistSets.subtitle")}
        actionLabel={t("common.viewAll")}
        onAction={() => onViewAll("core-tracks")}
        railControls={rail}
      />
      <SectionRail railRef={rail.railRef} fit="square-card">
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
      </SectionRail>
    </section>
  );
}
