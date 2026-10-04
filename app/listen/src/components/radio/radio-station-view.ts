import type { TFunction } from "i18next";

import type { RadioSeedKind } from "@/components/actions/radio-actions";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import {
  albumCoverApiUrl,
  albumPagePath,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

export interface RadioStationLike {
  type: RadioSeedKind;
  title: string;
  subtitle?: string | null;
  seed_type?: RadioSeedKind | null;
  seed_value?: string | null;
  seed_label?: string | null;
  seed_subtitle?: string | null;
  play_count?: number | null;
  artist_name?: string | null;
  artist_id?: number | null;
  global_artist_uid?: string | null;
  artist_entity_uid?: string | null;
  artist_slug?: string | null;
  album_name?: string | null;
  album_id?: number | null;
  global_album_uid?: string | null;
  album_entity_uid?: string | null;
  album_slug?: string | null;
  track_title?: string | null;
  genre_name?: string | null;
  genre_slug?: string | null;
  cover_url?: string | null;
}

const TYPE_LABEL_KEY: Record<RadioSeedKind, string> = {
  track: "home.radio.track",
  album: "home.radio.album",
  genre: "home.radio.genre",
  artist: "home.radio.artist",
};

export function radioSeedKind(station: RadioStationLike): RadioSeedKind {
  return station.seed_type ?? station.type;
}

export function radioTypeLabel(station: RadioStationLike, t: TFunction) {
  return t(TYPE_LABEL_KEY[radioSeedKind(station)]);
}

export function radioStationTitle(station: RadioStationLike): string {
  return (
    station.seed_label ||
    station.track_title ||
    station.album_name ||
    station.artist_name ||
    station.genre_name ||
    station.title.replace(/\s+Radio$/i, "")
  );
}

export function radioStationSubtitle(station: RadioStationLike) {
  return (
    station.seed_subtitle ||
    (station.type === "album" || station.type === "track"
      ? station.artist_name
      : null) ||
    null
  );
}

function artistRoute(station: RadioStationLike) {
  return {
    artistId: station.artist_id,
    globalArtistUid: station.global_artist_uid,
    artistEntityUid: station.artist_entity_uid,
    artistSlug: station.artist_slug,
    artistName: station.artist_name || station.seed_label,
  };
}

function albumRoute(station: RadioStationLike) {
  return {
    albumId: station.album_id,
    globalAlbumUid: station.global_album_uid,
    albumEntityUid: station.album_entity_uid,
    artistEntityUid: station.artist_entity_uid,
    albumSlug: station.album_slug,
    artistName: station.artist_name,
    albumName: station.album_name,
  };
}

export function radioStationArtwork(station: RadioStationLike): string | null {
  const explicitCover = resolveMaybeApiAssetUrl(station.cover_url);
  if (explicitCover) return explicitCover;
  if (station.type === "genre") return null;
  if (station.type === "album") {
    return albumCoverApiUrl(albumRoute(station), { size: 256 }) || null;
  }
  return artistPhotoApiUrl(artistRoute(station), { size: 256 }) || null;
}

export function radioStationSeedPath(station: RadioStationLike): string | null {
  const kind = radioSeedKind(station);
  if (kind === "genre") {
    const slug = station.genre_slug || station.seed_value;
    return slug ? `/explore?genre=${encodeURIComponent(slug)}` : null;
  }
  if (kind === "album" || kind === "track") {
    if (!station.album_name && station.album_id == null) return null;
    return albumPagePath(albumRoute(station));
  }
  if (!station.artist_name && station.artist_id == null) return null;
  return artistPagePath(artistRoute(station));
}
