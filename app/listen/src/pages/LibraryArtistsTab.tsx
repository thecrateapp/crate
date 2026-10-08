import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { MediaGrid } from "@crate/ui/domain/lists";
import { EmptyState, LoadingState } from "@crate/ui/domain/states";
import { Button } from "@crate/ui/shadcn/button";
import { ArtistCard } from "@/components/cards/ArtistCard";
import { useApi } from "@/hooks/use-api";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

import { CollectionSortDropdown } from "./LibraryCollectionSortDropdown";
import {
  artistSortOptions,
  type ArtistSort,
  type FollowedArtist,
} from "./library-collection-model";

export function LibraryArtistsTab() {
  const { t } = useTranslation();
  const { data: artists, loading } = useApi<FollowedArtist[]>(
    "/api/catalog/me/artists",
  );
  const isDesktop = useIsDesktop();
  const [sort, setSort] = useState<ArtistSort>("recent");

  const sortedArtists = useMemo(() => {
    if (!artists) return [];
    return [...artists].sort((a, b) => {
      if (sort === "name") {
        return a.artist_name.localeCompare(b.artist_name);
      }
      if (sort === "popularity") {
        const aScore = a.album_count * 12 + a.track_count;
        const bScore = b.album_count * 12 + b.track_count;
        return bScore - aScore || a.artist_name.localeCompare(b.artist_name);
      }
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
  }, [artists, sort]);

  if (loading) return <LoadingState label={t("common.loadingShort")} />;
  if (!artists || artists.length === 0) {
    return (
      <EmptyState
        variant="dashed"
        title={t("library.artists.emptyTitle")}
        description={t("library.artists.empty")}
        action={
          <Button asChild size="sm">
            <Link to="/explore">{t("nav.explore")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {!isDesktop ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold uppercase tracking-kicker text-text-primary/40">
            {t("library.sort.label")}
          </span>
          <CollectionSortDropdown
            label={t("library.sort.artists")}
            value={sort}
            options={artistSortOptions}
            onChange={setSort}
          />
        </div>
      ) : null}
      <MediaGrid>
        {sortedArtists.map((artist) => (
          <ArtistCard
            key={
              artist.global_artist_uid ?? artist.artist_id ?? artist.artist_name
            }
            name={artist.artist_name}
            artistId={artist.artist_id}
            artistEntityUid={artist.artist_entity_uid}
            globalArtistUid={artist.global_artist_uid}
            artistSlug={artist.artist_slug}
            photo={artist.photo_url ?? undefined}
            hasPhoto={artist.has_photo}
            subtitle={t("common.albumCountLabel", {
              count: artist.album_count,
            })}
            layout="grid"
          />
        ))}
      </MediaGrid>
    </div>
  );
}
