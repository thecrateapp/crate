import type { ReactNode } from "react";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import { MediaGrid } from "@crate/ui/domain/lists/MediaGrid";
/** These frames are app-local; managed cards, player state and navigation are injected. */
export function ArtistAlbumGroupFrame({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <SectionHeader title={title} className="mb-4" />
      <MediaGrid density="comfortable">{children}</MediaGrid>
    </section>
  );
}
export function ArtistTopTracksFrame({
  title,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <SectionHeader
        title={title}
        className="mb-4"
        actionLabel={actionLabel}
        onAction={onAction}
      />
      {children}
    </section>
  );
}
