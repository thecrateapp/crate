export type MediaKind = "album" | "artist" | "track" | "playlist";
export type MediaImageShape = "square" | "circle" | "rounded";

export interface MediaImage {
  url?: string | null;
  fallbackUrl?: string | null;
  shape?: MediaImageShape;
  alt?: string;
}

export interface BaseMediaEntity {
  kind: MediaKind;
  id?: string | number;
  uid?: string;
  slug?: string;
  name: string;
  subtitle?: string;
  image?: MediaImage;
  href?: string;
  external?: boolean;
}

export interface AlbumEntity extends BaseMediaEntity {
  kind: "album";
  artistName?: string;
  year?: number;
  trackCount?: number;
  duration?: number;
  format?: string;
  bitDepth?: number;
  sampleRate?: number;
}

export interface ArtistEntity extends BaseMediaEntity {
  kind: "artist";
  albumCount?: number;
  trackCount?: number;
  listenerCount?: number;
  genres?: string[];
}

export interface TrackEntity extends BaseMediaEntity {
  kind: "track";
  artistName?: string;
  albumName?: string;
  trackNumber?: number;
  duration?: number;
  isPlaying?: boolean;
}

export interface PlaylistEntity extends BaseMediaEntity {
  kind: "playlist";
  trackCount?: number;
  isSmart?: boolean;
  isFollowed?: boolean;
}

export type MediaEntity =
  | AlbumEntity
  | ArtistEntity
  | TrackEntity
  | PlaylistEntity;
