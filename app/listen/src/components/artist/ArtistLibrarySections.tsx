import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { Disc3 } from "@crate/ui/icons";

import { AlbumCard } from "@/components/cards/AlbumCard";
import { CrateImage } from "@/components/artwork/CrateImage";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import {
  buildArtistAlbumCover,
  topTrackToTrackRowData,
  type ArtistAlbum,
  type ArtistTopTrack,
} from "@/components/artist/artist-model";
import {
  albumCoverApiUrl,
  albumPagePath,
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
        <h2 className="text-lg font-semibold text-text-primary">
          {t("artist.sections.topTracks")}
        </h2>
        {topTracksPath ? (
          <button
            className="text-sm text-accent-action hover:underline"
            onClick={() => navigate(topTracksPath)}
          >
            {t("common.viewAll")}
          </button>
        ) : null}
      </div>
      <div className="rounded-xl">
        {tracks.map((track, index) => (
          <TrackRow
            key={
              track.id ??
              track.global_track_uid ??
              track.track_entity_uid ??
              track.library_track_id ??
              [track.artist, track.album, track.title].join(":")
            }
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
  if (/\blive\b/i.test(title)) return "live";
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

interface ArtistAlbumPresentation {
  globalAlbumUid: string | null;
  localAlbumId?: number;
  cover?: string;
  coverSrcSet?: string;
  albumName: string;
  coverRouteInput: Parameters<typeof albumCoverApiUrl>[0];
}

function buildArtistAlbumPresentation(
  album: ArtistAlbum,
  artistName: string,
  artistSlug?: string,
): ArtistAlbumPresentation {
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

  return {
    globalAlbumUid,
    localAlbumId,
    cover,
    coverSrcSet,
    albumName: album.display_name || album.name,
    coverRouteInput,
  };
}

function ArtistAlbumArtwork({
  album,
  cover,
  coverSrcSet,
}: {
  album: ArtistAlbum;
  cover?: string;
  coverSrcSet?: string;
}) {
  return (
    <div className="relative mb-2 aspect-square overflow-hidden rounded-lg bg-text-primary/5">
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
          <Disc3 size={32} className="text-text-primary/25" />
        </div>
      )}
    </div>
  );
}

function ArtistGlobalAlbumItem({
  album,
  artistName,
  artistSlug,
  presentation,
}: {
  album: ArtistAlbum;
  artistName: string;
  artistSlug?: string;
  presentation: ArtistAlbumPresentation;
}) {
  return (
    <Link
      to={albumPagePath({
        albumId: presentation.localAlbumId,
        globalAlbumUid: presentation.globalAlbumUid!,
        albumSlug: album.slug,
        artistSlug,
        artistName,
        albumName: presentation.albumName,
      })}
      className="group w-full min-w-0 snap-start cursor-pointer rounded-xl p-2 text-left transition-colors hover:bg-text-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <ArtistAlbumArtwork
        album={album}
        cover={presentation.cover}
        coverSrcSet={presentation.coverSrcSet}
      />
      <p className="truncate text-sm font-medium text-text-primary">
        {presentation.albumName}
      </p>
      <p className="truncate text-xs text-text-muted">
        {album.year ? `${album.year.slice(0, 4)} · ${artistName}` : artistName}
      </p>
    </Link>
  );
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
  const presentation = buildArtistAlbumPresentation(
    album,
    artistName,
    artistSlug,
  );

  if (presentation.globalAlbumUid) {
    return (
      <ArtistGlobalAlbumItem
        album={album}
        artistName={artistName}
        artistSlug={artistSlug}
        presentation={presentation}
      />
    );
  }

  return (
    <AlbumCard
      artist={artistName}
      album={presentation.albumName}
      albumId={presentation.localAlbumId}
      albumSlug={album.slug}
      artistSlug={artistSlug}
      year={album.year?.slice(0, 4)}
      cover={presentation.cover}
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
          <h2 className="mb-4 text-lg font-semibold text-text-primary">
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
