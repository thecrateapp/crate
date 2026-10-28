import type { ComponentProps, FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { CatalogSearchView } from "./search/CatalogSearchView";
import { catalogAlbumItem } from "./search/catalog-search-model";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import { CRATE_ICON_SIZE, Plus } from "@crate/ui/icons";
import { catalogAlbumUid, type CatalogAlbum } from "../pages/crates-types";
export function CrateAlbumPickerView({
  query,
  results,
  searching,
  addingUid,
  error,
  existingAlbumUids,
  onQueryChange,
  onSearch,
  onRetry,
  onAdd,
  coverUrl,
  renderImage,
}: {
  query: string;
  results: CatalogAlbum[];
  searching: boolean;
  addingUid: string | null;
  error: boolean;
  existingAlbumUids: ReadonlySet<string>;
  onQueryChange: (query: string) => void;
  onSearch: (event: FormEvent<HTMLFormElement>) => void;
  onRetry: () => void;
  onAdd: (album: CatalogAlbum, uid: string) => void;
  coverUrl: (album: CatalogAlbum) => string;
  renderImage?: ComponentProps<typeof MediaCover>["renderImage"];
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-3 rounded-xl border border-border-quiet bg-text-primary/[0.025] p-4">
      <SectionHeader title={t("library.crates.addAlbums")} />
      <form onSubmit={onSearch} role="search">
        <CatalogSearchView
          label={t("library.crates.searchAlbums")}
          query={query}
          onQueryChange={onQueryChange}
          kinds={["album"]}
          items={results.map((album) => ({
            ...catalogAlbumItem(album),
            imageUrl: coverUrl(album),
          }))}
          searching={searching}
          error={error ? t("library.crates.searchFailed") : undefined}
          onRetry={onRetry}
          emptyMessage={t("library.crates.noAlbumsFound")}
          renderImage={renderImage}
          renderAction={({ data: album }) => {
            const uid = catalogAlbumUid(album);
            return uid && existingAlbumUids.has(uid) ? (
              <InfoBadge>{t("library.crates.albumInCrate")}</InfoBadge>
            ) : (
              <ActionButton
                label={t("library.crates.addAlbum", {
                  album: album.name,
                  artist: album.artist,
                })}
                tooltip={t("common.add")}
                disabled={!uid}
                loading={addingUid === uid}
                onClick={() => uid && onAdd(album, uid)}
              >
                <Plus size={CRATE_ICON_SIZE.md} />
              </ActionButton>
            );
          }}
        />
      </form>
    </section>
  );
}
