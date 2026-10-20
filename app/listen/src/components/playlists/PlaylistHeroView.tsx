import type { ReactNode } from "react";
import { PageHero } from "@crate/ui/domain/hero";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
/** Shared by ordinary, curated and generated playlist adapters; images/actions are injected. */
export function PlaylistHeroView({
  title,
  description,
  metaItems,
  badges,
  artwork,
  actions,
}: {
  title: string;
  description?: string;
  metaItems: string[];
  badges?: ReactNode;
  artwork: (className: string) => ReactNode;
  actions: ReactNode;
}) {
  return (
    <PageHero
      variant="media"
      eyebrow={badges}
      title={title}
      description={description}
      meta={metaItems.map((item, index) => (
        <MonoLabel as="span" key={index}>
          {item}
        </MonoLabel>
      ))}
      artwork={artwork("size-full rounded-none")}
      background={{
        gradient: "strong",
        render: (className) => (
          <div className={className}>
            {artwork("h-full w-full rounded-none")}
          </div>
        ),
      }}
      actions={actions}
    />
  );
}
