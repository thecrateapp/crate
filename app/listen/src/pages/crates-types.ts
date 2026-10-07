import type { GenreProfileItem } from "@crate/ui/domain/genres/GenrePill";

export interface CrateAlbum {
  global_album_uid: string;
  position: number;
  name: string;
  artist_name: string;
  year?: string | null;
  has_cover: boolean;
}

export interface CrateSummary {
  id: string;
  short_code?: string | null;
  public_ref?: string | null;
  owner_id: number;
  owner_username?: string | null;
  owner_instagram_handle?: string | null;
  owner_name?: string | null;
  name: string;
  description: string;
  visibility: "private" | "public";
  is_collaborative: boolean;
  is_ordered: boolean;
  sort_direction: "asc" | "desc";
  loop_enabled: boolean;
  access: "owner" | "collaborator" | "public" | null;
  album_count: number;
  track_count: number;
  follower_count?: number;
  is_followed?: boolean;
  first_album: CrateAlbum | null;
  albums: CrateAlbum[];
  created_at?: string | null;
  updated_at?: string | null;
}

export type PublicCrate = Pick<
  CrateSummary,
  | "id"
  | "short_code"
  | "public_ref"
  | "name"
  | "description"
  | "is_collaborative"
  | "album_count"
  | "first_album"
  | "track_count"
  | "visibility"
  | "access"
  | "owner_id"
  | "follower_count"
  | "is_followed"
>;

export interface CrateDetail extends CrateSummary {
  albums: CrateAlbum[];
  owner_avatar?: string | null;
  genre_profile?: GenreProfileItem[];
}

export interface CratePlaybackTrack {
  global_track_uid: string;
  global_album_uid: string;
  global_artist_uid: string;
  local_track_id?: number | null;
  local_track_entity_uid?: string | null;
  title: string;
  artist: string;
  album?: string | null;
  duration?: number | null;
  disc_number?: number | null;
  track_number?: number | null;
}

export interface CrateMember {
  crate_id: string;
  user_id: number;
  username?: string | null;
  name?: string | null;
  display_name?: string | null;
  avatar?: string | null;
  role?: "owner" | "collaborator";
}

export interface CrateInvite {
  token: string;
  crate_id: string;
  join_url: string;
  created_at?: string | null;
  expires_at?: string | null;
  max_uses?: number | null;
  use_count: number;
}

export interface CatalogAlbum {
  id?: number;
  global_album_uid?: string;
  entity_uid?: string;
  album_entity_uid?: string;
  artist_entity_uid?: string;
  artist_id?: number;
  slug?: string;
  artist_slug?: string;
  artist: string;
  name: string;
  year?: string | number | null;
  has_cover?: boolean | number;
}

export function catalogAlbumUid(album: CatalogAlbum): string | null {
  return (
    album.global_album_uid ?? album.entity_uid ?? album.album_entity_uid ?? null
  );
}
