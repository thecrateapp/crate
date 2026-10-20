import {
  resolveGenrePercent,
  type GenreProfileItem,
} from "@crate/ui/domain/genres/GenrePill";
import { useApi } from "@/hooks/use-api";
import { artistApiPath } from "@/lib/library-routes";
import type { UpcomingItem } from "./upcoming-types";

interface ArtistGenreData {
  id?: number;
  name: string;
  genre_profile?: GenreProfileItem[];
}

/** Radar's legacy payload has genre names only. Read the existing artist resource on demand. */
export function useUpcomingGenreProfile(
  item: UpcomingItem,
  expanded: boolean,
): UpcomingItem {
  const genres: GenreProfileItem[] = item.genre_profile?.length
    ? item.genre_profile
    : (item.genres || []).map((name) => ({ name }));
  const needsProfile =
    genres.length === 0 ||
    genres.some((genre) => resolveGenrePercent(genre) == null);
  const path =
    expanded && needsProfile && (item.artist_id != null || item.artist_slug)
      ? artistApiPath({
          artistId: item.artist_id,
          artistSlug: item.artist_slug,
          artistName: item.artist,
        })
      : null;
  const { data } = useApi<ArtistGenreData>(path, "GET", undefined, {
    revalidateIfCached: "never",
  });
  const sameArtist =
    data &&
    (item.artist_id != null && data.id != null
      ? item.artist_id === data.id
      : item.artist.trim().toLowerCase() === data.name?.trim().toLowerCase());
  if (!path || !sameArtist || !data.genre_profile?.length) return item;
  const profile = genres.length
    ? genres.map((genre) => {
        if (resolveGenrePercent(genre) != null) return genre;
        const match = data.genre_profile!.find(
          (candidate) =>
            (genre.slug && candidate.slug && genre.slug === candidate.slug) ||
            candidate.name.trim().toLowerCase() ===
              genre.name.trim().toLowerCase(),
        );
        return match ? { ...match, name: genre.name } : genre;
      })
    : data.genre_profile;
  return { ...item, genre_profile: profile };
}
