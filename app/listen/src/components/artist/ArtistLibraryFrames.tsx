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
    <section className="space-y-4" aria-label={title}>
      <SectionHeader title={title} />
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
    <section className="space-y-4" aria-label={title}>
      <SectionHeader
        title={title}

        actionLabel={actionLabel}
        onAction={onAction}
      />
      {children}
    </section>
  );
}

/** V2 community-card scale: two/three/four/five columns; discography has its own role above. */
export function ArtistCommunityGroupFrame({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4" aria-label={title}>
      <SectionHeader title={title} />
      <MediaGrid
        density="comfortable"
        className="md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
      >
        {children}
      </MediaGrid>
    </section>
  );
}
