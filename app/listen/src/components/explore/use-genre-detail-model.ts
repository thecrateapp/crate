import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

import { useApi } from "@/hooks/use-api";

import type { GenreDetail } from "./explore-model";
import { buildGenreHeroCoverCandidates } from "./genre-covers";

export function useGenreDetailModel(slug: string) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const { data, loading } = useApi<GenreDetail>(
    `/api/catalog/genres/${slug}`,
    "GET",
    undefined,
    { revalidateIfCached: "never" },
  );
  const primaryArtists = useMemo(
    () =>
      (data?.artists ?? []).filter(
        (artist) => artist.membership !== "inherited",
      ),
    [data?.artists],
  );
  const primaryAlbums = useMemo(
    () =>
      (data?.albums ?? []).filter((album) => album.membership !== "inherited"),
    [data?.albums],
  );
  const nextShow = data?.shows?.[0] ?? null;
  const fallbackGenreSlug = data?.canonical_slug || data?.slug;
  const heroCoverCandidates = useMemo(
    () =>
      buildGenreHeroCoverCandidates(
        data?.cover_url,
        fallbackGenreSlug,
        primaryArtists,
      ),
    [data?.cover_url, fallbackGenreSlug, primaryArtists],
  );
  const heroCoverFingerprint = heroCoverCandidates.join("|");
  const [heroCoverIndex, setHeroCoverIndex] = useState(0);
  useEffect(() => {
    setHeroCoverIndex(0);
  }, [heroCoverFingerprint]);

  if (!data) {
    return {
      data,
      loading,
      isDesktop,
      primaryArtists,
      primaryAlbums,
      nextShow,
      heroCoverCandidates,
      heroCoverIndex,
      heroCoverUrl: heroCoverCandidates[heroCoverIndex] ?? null,
      description: t("genre.defaultDescription"),
      artistCount: 0,
      albumCount: 0,
      trackCount: 0,
      visibleArtists: primaryArtists,
      visibleAlbums: primaryAlbums,
      visibleRelatedGenres: [],
      setHeroCoverIndex,
    };
  }

  const description =
    data.description ||
    data.canonical_description ||
    data.external_description ||
    t("genre.defaultDescription");
  const hasArtistMemberships = data.artists.some((artist) => artist.membership);
  const hasAlbumMemberships = data.albums.some((album) => album.membership);
  const artistCount = hasArtistMemberships
    ? primaryArtists.length
    : data.artist_count ?? primaryArtists.length;
  const albumCount = hasAlbumMemberships
    ? primaryAlbums.length
    : data.album_count ?? primaryAlbums.length;
  const directAlbumTrackCount = primaryAlbums.reduce(
    (total, album) => total + (album.track_count || 0),
    0,
  );
  const trackCount = hasAlbumMemberships
    ? directAlbumTrackCount
    : data.track_count ?? directAlbumTrackCount;

  return {
    data,
    loading,
    isDesktop,
    primaryArtists,
    primaryAlbums,
    nextShow,
    heroCoverCandidates,
    heroCoverIndex,
    heroCoverUrl: heroCoverCandidates[heroCoverIndex] ?? null,
    description,
    artistCount,
    albumCount,
    trackCount,
    visibleArtists: isDesktop ? primaryArtists : primaryArtists.slice(0, 12),
    visibleAlbums: isDesktop ? primaryAlbums : primaryAlbums.slice(0, 12),
    visibleRelatedGenres: (data.related_genres ?? []).slice(
      0,
      isDesktop ? 12 : 6,
    ),
    setHeroCoverIndex,
  };
}
