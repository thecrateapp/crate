import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import { EmptyState } from "@crate/ui/domain/states";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

/** Actual crate album section; linked actions and image transport stay with adapters. */
export function CrateAlbumListView({
  count,
  children,
}: {
  count: number;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section
      data-slot="crate-album-list"
      className="mx-auto max-w-content space-y-4 px-4 sm:px-6"
    >
      <SectionHeader
        title={t("crate.page.albums")}
        action={<MonoLabel>{t("common.albumCountLabel", { count })}</MonoLabel>}
      />
      {count ? (
        <ol className="space-y-1">{children}</ol>
      ) : (
        <EmptyState variant="dashed" message={t("crate.page.noAlbums")} />
      )}
    </section>
  );
}
/** Domain row surface: Diego's crate-only hover amendment, separate from generic EntityRow. */
export function CrateAlbumListItem({ children }: { children: ReactNode }) {
  return (
    <li className="transition-colors pointer-fine:hover:bg-accent-action/[0.04]">
      {children}
    </li>
  );
}
export function CrateAlbumPreviewRowView({
  title,
  artist,
  year,
  rank,
  artwork,
}: {
  title: string;
  artist: string;
  year?: string | null;
  rank: number;
  artwork: ReactNode;
}) {
  return (
    <EntityRow
      title={title}
      subtitle={artist}
      rank={rank}
      meta={year ? <MonoLabel as="span">{year}</MonoLabel> : undefined}
      leading={artwork}
    />
  );
}
