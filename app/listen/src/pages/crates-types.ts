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
  owner_id: number;
  owner_username?: string | null;
  owner_name?: string | null;
  name: string;
  description: string;
  visibility: "private" | "public";
  is_collaborative: boolean;
  access: "owner" | "collaborator" | "public" | null;
  album_count: number;
  first_album: CrateAlbum | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export type PublicCrate = Pick<
  CrateSummary,
  | "id"
  | "name"
  | "description"
  | "is_collaborative"
  | "album_count"
  | "first_album"
>;

export interface CrateDetail extends CrateSummary {
  albums: CrateAlbum[];
}

export interface CrateMember {
  crate_id: string;
  user_id: number;
  username?: string | null;
  display_name?: string | null;
  avatar?: string | null;
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
