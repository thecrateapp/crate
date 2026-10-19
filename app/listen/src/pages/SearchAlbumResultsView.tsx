import { Fragment, type Key, type ReactNode } from "react";
import { MediaGrid, SectionHeader } from "@crate/ui/domain/lists";
import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
export type SearchAlbumViewItem =
  | { key: Key; content: ReactNode }
  | {
      key: Key;
      title: string;
      subtitle?: string;
      href: string;
      artwork: ReactNode;
    };
export function SearchAlbumResultsView({
  title,
  items,
}: {
  title: string;
  items: SearchAlbumViewItem[];
}) {
  return (
    <section>
      <SectionHeader className="mb-3" title={title} />
      <MediaGrid>
        {items.map((item) =>
          "content" in item ? (
            <Fragment key={item.key}>{item.content}</Fragment>
          ) : (
            <EntityCard
              key={item.key}
              layout="grid"
              title={item.title}
              subtitle={item.subtitle}
              href={item.href}
              artwork={item.artwork}
            />
          ),
        )}
      </MediaGrid>
    </section>
  );
}
