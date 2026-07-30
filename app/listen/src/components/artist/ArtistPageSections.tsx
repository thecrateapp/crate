import { Calendar, Disc3, Play } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { AlbumCard } from "@/components/cards/AlbumCard";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { CrateImage } from "@/components/artwork/CrateImage";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { useMemo } from "react";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import {
  buildArtistAlbumCover,
  buildArtistPhotoUrl,
  topTrackToTrackRowData,
  type ArtistAlbum,
  type ArtistPlaylistAppearance,
  type ArtistTopTrack,
} from "@/components/artist/artist-model";
import {
  groupByMonth,
  itemKey,
  UpcomingMonthGroup,
  type UpcomingItem,
} from "@/components/upcoming/UpcomingRows";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistPagePath,
  artistTopTracksPath,
  responsiveImageSrcSet,
} from "@/lib/library-routes";

const ARTIST_ALBUM_IMAGE_WIDTHS = [160, 256, 320, 480] as const;

interface ArtistTopTracksSectionProps {
  artistId?: number;
  artistSlug?: string;
  tracks: ArtistTopTrack[];
  coverFallback?: string;
}

export function ArtistTopTracksSection({
  artistId,
  artistSlug,
  tracks,
  coverFallback,
}: ArtistTopTracksSectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const topTracksPath =
    artistId != null || artistSlug
      ? artistTopTracksPath({ artistId, artistSlug })
      : "";
  const trackRows = useMemo<TrackRowData[]>(
    () => tracks.map((track) => topTrackToTrackRowData(track)),
    [tracks],
  );
  if (!tracks.length) return null;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-foreground">
          {t("artist.sections.topTracks")}
        </h2>
        {topTracksPath ? (
          <button
            className="text-sm text-primary hover:underline"
            onClick={() => navigate(topTracksPath)}
          >
            {t("common.viewAll")}
          </button>
        ) : null}
      </div>
      <div className="rounded-xl">
        {tracks.map((track, index) => (
          <TrackRow
            key={`${track.id}-${index}`}
            track={trackRows[index]!}
            index={track.track || index + 1}
            showAlbum
            albumCover={
              track.album_id || track.global_album_uid
                ? buildArtistAlbumCover(
                    track.artist,
                    track.album,
                    track.album_id,
                    track.album_slug,
                    track.global_album_uid,
                  )
                : coverFallback
            }
            showCoverThumb
            queueTracks={trackRows}
          />
        ))}
      </div>
    </section>
  );
}

interface ArtistAlbumsSectionProps {
  artistName: string;
  artistSlug?: string;
  albums: ArtistAlbum[];
}

type ArtistReleaseCategory = NonNullable<ArtistAlbum["release_category"]>;

const RELEASE_GROUPS: {
  category: ArtistReleaseCategory;
  labelKey: string;
}[] = [
  { category: "album", labelKey: "artist.sections.albums" },
  { category: "ep_single", labelKey: "artist.sections.epsAndSingles" },
  { category: "compilation", labelKey: "artist.sections.compilations" },
  { category: "live", labelKey: "artist.sections.liveAlbums" },
  { category: "other", labelKey: "artist.sections.otherReleases" },
];

function releaseCategory(album: ArtistAlbum): ArtistReleaseCategory {
  if (album.release_category) return album.release_category;

  const primaryType = album.release_type?.trim().toLocaleLowerCase() ?? "";
  const secondaryTypes = new Set(
    (album.release_secondary_types ?? []).map((value) =>
      value.trim().toLocaleLowerCase(),
    ),
  );

  if (secondaryTypes.has("live")) return "live";
  if (secondaryTypes.has("compilation")) return "compilation";
  if (
    [
      "remix",
      "soundtrack",
      "spokenword",
      "audiobook",
      "interview",
      "audio drama",
      "dj-mix",
      "mixtape/street",
    ].some((value) => secondaryTypes.has(value))
  ) {
    return "other";
  }
  if (primaryType === "ep" || primaryType === "single") return "ep_single";
  if (primaryType === "album") return "album";
  if (primaryType) return "other";

  const title = album.display_name || album.name;
  if (/\blive\b/i.test(title)) {
    return "live";
  }
  if (
    /\b(?:best of|greatest hits|anthology|compilation|complete albums?|collected|collection)\b/i.test(
      title,
    )
  ) {
    return "compilation";
  }
  if (/\b(?:ep|single)\b/i.test(title) || album.tracks === 1) {
    return "ep_single";
  }
  return "album";
}

function ArtistAlbumItem({
  album,
  artistName,
  artistSlug,
}: {
  album: ArtistAlbum;
  artistName: string;
  artistSlug?: string;
}) {
  const globalAlbumUid =
    album.global_album_uid ??
    album.global_uid ??
    (typeof album.id === "string" ? album.id : null);
  const localAlbumId =
    typeof album.id === "number" && !album.is_pre_release
      ? album.id
      : undefined;
  const cover =
    album.cover_url ||
    buildArtistAlbumCover(
      artistName,
      album.name,
      localAlbumId,
      album.slug,
      globalAlbumUid,
      album.entity_uid,
    );
  const coverRouteInput = {
    albumId: localAlbumId,
    albumEntityUid: album.entity_uid ?? undefined,
    globalAlbumUid: album.entity_uid ? undefined : globalAlbumUid,
    albumSlug: album.slug,
    artistSlug,
    artistName,
    albumName: album.display_name || album.name,
  };
  const coverSrcSet = album.cover_url
    ? undefined
    : responsiveImageSrcSet(ARTIST_ALBUM_IMAGE_WIDTHS, (size) =>
        albumCoverApiUrl(coverRouteInput, { size }),
      );

  if (globalAlbumUid) {
    return (
      <Link
        to={albumPagePath({
          albumId: localAlbumId,
          globalAlbumUid,
          albumSlug: album.slug,
          artistSlug,
          artistName,
          albumName: album.display_name || album.name,
        })}
        className="group w-full min-w-0 snap-start cursor-pointer rounded-xl p-2 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <div className="relative mb-2 aspect-square overflow-hidden rounded-lg bg-white/5">
          {cover ? (
            <CrateImage
              src={cover}
              srcSet={coverSrcSet}
              sizes="(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 20vw"
              alt={album.display_name || album.name}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Disc3 size={32} className="text-white/25" />
            </div>
          )}
        </div>
        <p className="truncate text-sm font-medium text-foreground">
          {album.display_name || album.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {album.year
            ? `${album.year.slice(0, 4)} · ${artistName}`
            : artistName}
        </p>
      </Link>
    );
  }

  return (
    <AlbumCard
      artist={artistName}
      album={album.display_name || album.name}
      albumId={localAlbumId}
      albumSlug={album.slug}
      artistSlug={artistSlug}
      year={album.year?.slice(0, 4)}
      cover={cover}
      isPreRelease={album.is_pre_release}
      releaseDate={album.release_date}
      layout="grid"
    />
  );
}

export function ArtistAlbumsSection({
  artistName,
  artistSlug,
  albums,
}: ArtistAlbumsSectionProps) {
  const { t } = useTranslation();
  const groupedAlbums = useMemo(
    () =>
      RELEASE_GROUPS.map((group) => ({
        ...group,
        albums: albums.filter(
          (album) => releaseCategory(album) === group.category,
        ),
      })).filter((group) => group.albums.length > 0),
    [albums],
  );
  if (!albums.length) return null;

  return (
    <div className="space-y-10">
      {groupedAlbums.map((group) => (
        <section key={group.category}>
          <h2 className="mb-4 text-lg font-semibold text-foreground">
            {t(group.labelKey)}
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {group.albums.map((album) => (
              <ArtistAlbumItem
                key={
                  album.global_album_uid ??
                  album.global_uid ??
                  album.id ??
                  `${album.name}-${album.year}`
                }
                album={album}
                artistName={artistName}
                artistSlug={artistSlug}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface ArtistShowsSectionProps {
  shows: UpcomingItem[];
  expandedShowId: string | null;
  artistHotNow: boolean;
  onToggleExpand: (showId: string | null) => void;
  onPlayProbableSetlist: () => void;
}

export function ArtistShowsSection({
  shows,
  expandedShowId,
  artistHotNow,
  onToggleExpand,
  onPlayProbableSetlist,
}: ArtistShowsSectionProps) {
  const { t, i18n } = useTranslation();
  const nextAttendingShow = shows.find((item) => item.user_attending);
  if (!shows.length) return null;

  return (
    <section>
      <div className="mb-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold text-foreground">
            {t("artist.sections.shows")}
          </h2>
          {artistHotNow ? (
            <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-primary">
              {t("artist.sections.heavyRotation")}
            </div>
          ) : null}
        </div>

        {nextAttendingShow ? (
          <div className="rounded-[12px] border border-primary/15 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.14),transparent_40%),rgba(255,255,255,0.03)] p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
                  <Calendar size={12} />
                  {t("artist.sections.showPrep")}
                </div>
                <h3 className="mt-3 text-xl font-bold text-foreground">
                  {nextAttendingShow.title}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {nextAttendingShow.subtitle} ·{" "}
                  {new Date(
                    `${nextAttendingShow.date}T12:00:00`,
                  ).toLocaleDateString(i18n.language, {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
                <p className="mt-3 text-sm leading-6 text-white/70">
                  {nextAttendingShow.probable_setlist?.length
                    ? t("artist.sections.attendingWithSetlist")
                    : t("artist.sections.attendingWithoutSetlist")}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {nextAttendingShow.probable_setlist?.length ? (
                  <button
                    onClick={onPlayProbableSetlist}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Play size={14} fill="currentColor" />
                    {t("artist.sections.playProbableSetlist")}
                  </button>
                ) : null}
                <button
                  onClick={() => onToggleExpand(itemKey(nextAttendingShow, 0))}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm text-white/65 transition-colors hover:border-white/20 hover:text-foreground"
                >
                  {t("artist.sections.viewShowDetails")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        {groupByMonth(shows).map(([month, monthItems]) => (
          <UpcomingMonthGroup
            key={month}
            month={month}
            items={monthItems}
            expandedId={expandedShowId}
            onToggleExpand={onToggleExpand}
          />
        ))}
      </div>
    </section>
  );
}

interface RelatedArtistsSectionProps {
  artists: {
    name: string;
    match: number;
    id?: number;
    slug?: string;
    image_url?: string | null;
    url?: string | null;
    source?: string | null;
  }[];
}

export function RelatedArtistsSection({ artists }: RelatedArtistsSectionProps) {
  const { t } = useTranslation();
  if (!artists.length) return null;

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-foreground">
        {t("artist.sections.relatedArtists")}
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {artists.slice(0, 15).map((artist) => {
          const inLibrary = artist.id != null;
          return (
            <ArtistCard
              key={artist.id ?? artist.name}
              name={artist.name}
              artistId={artist.id}
              artistSlug={artist.slug}
              photo={
                inLibrary
                  ? buildArtistPhotoUrl(artist.name, artist.id, artist.slug)
                  : artist.image_url || undefined
              }
              subtitle={
                artist.match
                  ? t("artist.sections.match", {
                      percent: Math.round(artist.match * 100),
                    })
                  : undefined
              }
              href={
                inLibrary
                  ? artistPagePath({
                      artistId: artist.id,
                      artistSlug: artist.slug,
                    })
                  : artist.url ||
                    `https://www.last.fm/music/${encodeURIComponent(
                      artist.name,
                    )}`
              }
              external={!inLibrary}
              imageTone={inLibrary ? "normal" : "muted"}
              large
              layout="grid"
            />
          );
        })}
      </div>
    </section>
  );
}

interface ArtistAppearsOnSectionProps {
  playlists: ArtistPlaylistAppearance[];
}

export function ArtistAppearsOnSection({
  playlists,
}: ArtistAppearsOnSectionProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (!playlists.length) return null;

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-foreground">
        {t("artist.sections.appearsOn")}
      </h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {playlists.slice(0, 8).map((playlist) => {
          const artistTrackCount = playlist.artist_track_count ?? 0;
          return (
            <PlaylistCard
              key={playlist.id}
              playlistId={playlist.id}
              name={playlist.name}
              isSmart={!!playlist.is_smart}
              description={playlist.description ?? undefined}
              tracks={playlist.artwork_tracks}
              coverDataUrl={playlist.cover_data_url}
              meta={
                artistTrackCount > 0
                  ? t("artist.sections.tracksHere", {
                      count: artistTrackCount,
                    })
                  : t("common.trackCountLabel", {
                      count: playlist.track_count ?? 0,
                    })
              }
              systemPlaylist
              crateManaged={playlist.scope === "system"}
              layout="grid"
              onClick={() => navigate(`/curation/playlist/${playlist.id}`)}
            />
          );
        })}
      </div>
    </section>
  );
}
