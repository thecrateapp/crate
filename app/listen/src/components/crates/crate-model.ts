import { publicCrateAlbumCoverUrl, publicShareUrl } from "@/lib/share-url";
import type { SharePayload } from "@/lib/social-share";
import type { CrateAlbum, CrateSummary } from "@/pages/crates-types";

export interface NumberedCrateAlbum extends CrateAlbum {
  displayNumber: number;
}

export function orderCrateAlbums(
  albums: CrateAlbum[],
  isOrdered: boolean,
  sortDirection: "asc" | "desc",
): NumberedCrateAlbum[] {
  const ascending = [...albums]
    .sort((left, right) => left.position - right.position)
    .map((album, index) => ({ ...album, displayNumber: index + 1 }));
  return isOrdered && sortDirection === "desc"
    ? ascending.reverse()
    : ascending;
}

export function crateSummaryAlbums(crate: CrateSummary): CrateAlbum[] {
  if (crate.albums?.length) return crate.albums;
  return crate.first_album ? [crate.first_album] : [];
}

export function isShareableCrate(crate: Pick<CrateSummary, "visibility">) {
  return crate.visibility === "public";
}

export function crateRef(crate: Pick<CrateSummary, "id" | "public_ref">) {
  return crate.public_ref || crate.id;
}

export function cratePagePath(crate: Pick<CrateSummary, "id" | "public_ref">) {
  return `/crate/${encodeURIComponent(crateRef(crate))}`;
}

export function crateOwnerName(
  crate: Pick<CrateSummary, "owner_name" | "owner_username">,
): string | null {
  return crate.owner_name || crate.owner_username || null;
}

export function buildCrateSharePayload(
  crate: CrateSummary,
  albums: NumberedCrateAlbum[],
): SharePayload {
  const firstAlbum = albums[0];
  return {
    kind: "crate",
    title: crate.name,
    subtitle: crateOwnerName(crate),
    url: publicShareUrl(`/share/crate/${encodeURIComponent(crateRef(crate))}`),
    imageUrl: firstAlbum?.has_cover
      ? publicCrateAlbumCoverUrl(crate.id, firstAlbum.global_album_uid, 512)
      : null,
    crateAlbums: albums.map((album) => ({
      imageUrl: album.has_cover
        ? publicCrateAlbumCoverUrl(crate.id, album.global_album_uid, 768)
        : null,
      name: album.name,
      artistName: album.artist_name,
      position: album.displayNumber - 1,
    })),
    crateAlbumCount: crate.album_count,
    crateIsOrdered: crate.is_ordered,
    crateOwnerName: crateOwnerName(crate),
    crateSortDirection: crate.sort_direction,
    crateTrackCount: crate.track_count,
  };
}
