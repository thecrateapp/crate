import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { GridSkeleton } from "@crate/ui/composites/GridSkeleton";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { MediaGrid } from "@crate/ui/domain/lists";
import { EmptyState, LoadingState } from "@crate/ui/domain/states";
import { Button } from "@crate/ui/shadcn/button";
import { AlbumCard } from "@/components/cards/AlbumCard";
import { useApi } from "@/hooks/use-api";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

import { CollectionSortDropdown } from "./LibraryCollectionSortDropdown";
import {
  albumSortOptions,
  type AlbumSort,
  type SavedAlbum,
} from "./library-collection-model";

export function LibraryAlbumsTab() {
  const { t } = useTranslation();
  const {
    data: albums,
    loading,
    error,
    refetch,
  } = useApi<SavedAlbum[]>("/api/catalog/me/albums");
  const isDesktop = useIsDesktop();
  const [sort, setSort] = useState<AlbumSort>("recent");

  const sortedAlbums = useMemo(() => {
    if (!albums) return [];
    return [...albums].sort((a, b) => {
      if (sort === "name") {
        return a.name.localeCompare(b.name);
      }
      if (sort === "artist") {
        return a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name);
      }
      if (sort === "year") {
        return (
          Number(b.year || 0) - Number(a.year || 0) ||
          a.name.localeCompare(b.name)
        );
      }
      return new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime();
    });
  }, [albums, sort]);

  if (loading)
    return (
      <LoadingState label={t("common.loadingShort")}>
        <div className="space-y-4">
          {!isDesktop ? (
            <div
              data-slot="library-sort-placeholder"
              aria-hidden="true"
              className="flex h-10 items-center justify-between gap-3"
            >
              <span className="font-mono text-label text-text-subtle">—</span>
              <span className="flex h-10 w-43 items-center text-sm text-text-muted">
                —
              </span>
            </div>
          ) : null}
          <GridSkeleton density="default" variant="album" />
        </div>
      </LoadingState>
    );
  if (error && !albums)
    return (
      <ErrorState
        message={error}
        onRetry={refetch}
        retryLabel={t("common.retry")}
      />
    );
  if (!albums || albums.length === 0) {
    return (
      <EmptyState
        variant="dashed"
        title={t("library.albums.emptyTitle")}
        description={t("library.albums.emptyDescription")}
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
          <MonoLabel>{t("library.sort.label")}</MonoLabel>
          <CollectionSortDropdown
            label={t("library.sort.albums")}
            value={sort}
            options={albumSortOptions}
            onChange={setSort}
          />
        </div>
      ) : null}
      <MediaGrid aria-label={t("nav.collection.albums")}>
        {sortedAlbums.map((album) => (
          <AlbumCard
            key={album.global_album_uid ?? album.id}
            artist={album.artist}
            album={album.name}
            albumId={album.id ?? undefined}
            albumEntityUid={album.album_entity_uid}
            globalAlbumUid={album.global_album_uid}
            artistEntityUid={album.artist_entity_uid}
            albumSlug={album.slug}
            year={album.year}
            cover={album.cover_url ?? undefined}
            layout="grid"
          />
        ))}
      </MediaGrid>
    </div>
  );
}
