import {
  albumCoverAssetPath,
  artistPhotoAssetPath,
} from "../../../../shared/web/library-routes";
export type CatalogSearchKind = "track" | "album" | "artist" | "genre";
export interface CatalogSearchItem<T = unknown> {
  key: string;
  kind: CatalogSearchKind;
  title: string;
  subtitle?: string;
  meta?: string;
  imageUrl?: string | null;
  data: T;
}
export interface TrackAlbumIdentity {
  globalAlbumUid?: string;
  global_album_uid?: string;
  albumId?: number;
  album_id?: number;
  albumEntityUid?: string;
  album_entity_uid?: string;
  albumSlug?: string;
  album_slug?: string;
  artistEntityUid?: string;
  artist_entity_uid?: string;
  artistSlug?: string;
  artist_slug?: string;
  cover?: string;
  albumCover?: string;
  album_cover?: string;
}
export interface CatalogTrack extends TrackAlbumIdentity {
  id?: number | string;
  entity_uid?: string;
  global_track_uid?: string;
  globalTrackUid?: string;
  global_uid?: string;
  title: string;
  artist: string;
  album?: string;
  path?: string | null;
  duration?: number;
}
export function trackAlbumIdentity(track: TrackAlbumIdentity) {
  return {
    globalAlbumUid: track.globalAlbumUid ?? track.global_album_uid,
    albumId: track.albumId ?? track.album_id,
    albumEntityUid: track.albumEntityUid ?? track.album_entity_uid,
    albumSlug: track.albumSlug ?? track.album_slug,
    artistEntityUid: track.artistEntityUid ?? track.artist_entity_uid,
    artistSlug: track.artistSlug ?? track.artist_slug,
    cover: track.cover ?? track.albumCover ?? track.album_cover,
  };
}
export function trackCoverPath(
  track: TrackAlbumIdentity & { artist: string; album?: string },
): string | undefined {
  const identity = trackAlbumIdentity(track);
  if (identity.cover) return identity.cover;
  if (
    !identity.globalAlbumUid &&
    !identity.albumEntityUid &&
    identity.albumId == null &&
    !(track.artist && track.album)
  )
    return undefined;
  return (
    albumCoverAssetPath(
      { ...identity, artistName: track.artist, albumName: track.album },
      { size: 128 },
    ) || undefined
  );
}
export function catalogTrackItem<T extends CatalogTrack>(
  track: T,
): CatalogSearchItem<T> {
  const global =
    track.globalTrackUid ?? track.global_track_uid ?? track.global_uid;
  return {
    key: global
      ? `global:${global}`
      : track.entity_uid
        ? `entity:${track.entity_uid}`
        : track.id != null
          ? `id:${track.id}`
          : track.path
            ? `path:${track.path}`
            : `${track.artist}:${track.album}:${track.title}`,
    kind: "track",
    title: track.title,
    subtitle: [track.artist, track.album].filter(Boolean).join(" · "),
    imageUrl: trackCoverPath(track),
    data: track,
  };
}
interface AlbumResult {
  id?: number;
  global_album_uid?: string;
  global_uid?: string;
  entity_uid?: string;
  album_entity_uid?: string;
  artist_entity_uid?: string;
  artist_slug?: string;
  slug?: string;
  name: string;
  artist: string;
  year?: string | number | null;
}
export function catalogAlbumItem<T extends AlbumResult>(
  album: T,
): CatalogSearchItem<T> {
  const uid =
    album.global_album_uid ??
    album.global_uid ??
    album.entity_uid ??
    album.album_entity_uid;
  return {
    key:
      uid ??
      String(album.id ?? `${album.artist}:${album.name}:${album.year ?? ""}`),
    kind: "album",
    title: album.name,
    subtitle: album.artist,
    meta: album.year != null ? String(album.year) : undefined,
    imageUrl:
      albumCoverAssetPath(
        {
          globalAlbumUid: uid,
          albumId: album.id,
          albumEntityUid: album.album_entity_uid,
          artistEntityUid: album.artist_entity_uid,
          albumSlug: album.slug,
          artistSlug: album.artist_slug,
          artistName: album.artist,
          albumName: album.name,
        },
        { size: 128 },
      ) || undefined,
    data: album,
  };
}
interface ArtistResult {
  id?: number;
  global_artist_uid?: string;
  global_uid?: string;
  entity_uid?: string;
  slug?: string;
  name: string;
}
export function catalogArtistItem<T extends ArtistResult>(
  artist: T,
): CatalogSearchItem<T> {
  const uid = artist.global_artist_uid ?? artist.global_uid;
  return {
    key: uid ?? artist.entity_uid ?? String(artist.id ?? artist.name),
    kind: "artist",
    title: artist.name,
    imageUrl:
      artistPhotoAssetPath(
        {
          globalArtistUid: uid,
          artistEntityUid: artist.entity_uid,
          artistId: artist.id,
          artistSlug: artist.slug,
          artistName: artist.name,
        },
        { size: 128 },
      ) || undefined,
    data: artist,
  };
}
