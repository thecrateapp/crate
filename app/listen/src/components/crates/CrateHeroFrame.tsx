import type { ReactNode } from "react";
import { PageHero } from "@crate/ui/domain/hero";
/** Existing V2 free-standing coverflow composition; image transport and data stay in adapters. */
export function CrateHeroFrame({
  title,
  description,
  owner,
  metaItems,
  actions,
  artwork,
  renderBackground,
  contentClassName,
  children,
}: {
  title: string;
  description?: string;
  owner: ReactNode;
  metaItems: ReactNode[];
  actions: ReactNode;
  artwork: ReactNode;
  renderBackground: (className: string) => ReactNode;
  contentClassName?: string;
  children?: ReactNode;
}) {
  return (
    <div data-testid="crate-hero">
      <PageHero
        variant="media"
        height="content"
        contentClassName={contentClassName}
        artworkFrame="none"
        artworkClassName="block aspect-auto w-full overflow-visible rounded-none sm:w-1/2 lg:w-[58%] lg:max-w-[720px]"
        titleSize="compact"
        actionsClassName="pt-0"
        background={{ treatment: "blur", render: renderBackground }}
        artwork={artwork}
        title={title}
        subtitle={owner}
        meta={metaItems}
        metaSeparator="dot"
        description={description}
        actions={actions}
      >
        {children}
        <div aria-hidden="true" className="hidden lg:block lg:h-14" />
      </PageHero>
    </div>
  );
}
