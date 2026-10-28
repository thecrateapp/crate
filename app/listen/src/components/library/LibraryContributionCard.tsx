import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  EntityCard,
  type EntityCardOverlay,
  type EntityMenuRenderer,
} from "@crate/ui/domain/entity";
import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { CRATE_ICON_SIZE, Upload } from "@crate/ui/icons";

/** Contributions share the album card geometry; their adapter supplies album and ownership actions. */
export function LibraryContributionCard({
  title,
  artist,
  artwork,
  artworkOverlay,
  sourceLabel,
  href,
  onOpen,
  overlay,
  renderMenu,
}: {
  title: string;
  artist: ReactNode;
  artwork: ReactNode;
  artworkOverlay?: ReactNode;
  sourceLabel?: string | null;
  href?: string;
  onOpen?: () => void;
  overlay?: EntityCardOverlay;
  renderMenu: EntityMenuRenderer;
}) {
  const { t } = useTranslation();
  const source = sourceLabel?.trim().toLowerCase();
  const SourceIcon =
    source === "bandcamp" ? BandcampLogo : source === "upload" ? Upload : null;
  return (
    <EntityCard
      layout="grid"
      title={title}
      subtitle={artist}
      meta={
        sourceLabel ? (
          <MonoLabel
            as="span"
            tone={source === "bandcamp" ? "accent" : "subtle"}
            className="inline-flex items-center gap-1"
          >
            {SourceIcon ? (
              <SourceIcon
                size={CRATE_ICON_SIZE.micro}
                aria-hidden="true"
                className="shrink-0"
              />
            ) : null}
            {sourceLabel}
          </MonoLabel>
        ) : undefined
      }
      artwork={artwork}
      artworkOverlay={artworkOverlay}
      overlay={overlay}
      href={href}
      onOpen={onOpen}
      renderMenu={renderMenu}
      menuLabel={t("actions.menu.more")}
      className="listen-deferred-grid-item"
    />
  );
}
