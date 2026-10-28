import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { EntityCard } from "@crate/ui/domain/entity/EntityCard";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Radio } from "@crate/ui/icons";

type CardProps = ComponentProps<typeof EntityCard>;
export function RadioStationCardView({
  title,
  subtitle,
  typeLabel,
  artworkUrl,
  playCount,
  disabled,
  onPlay,
  openLabel,
  actionMenu,
  renderImage,
}: {
  title: string;
  subtitle?: string | null;
  typeLabel: string;
  artworkUrl?: string | null;
  playCount?: number | null;
  disabled?: boolean;
  onPlay: () => void;
  openLabel: string;
  actionMenu?: CardProps["actionMenu"];
  renderImage?: NonNullable<CardProps["cover"]>["renderImage"];
}) {
  const { t } = useTranslation();
  return (
    <EntityCard
      title={title}
      layout="grid"
      disabled={disabled}
      onOpen={onPlay}
      openLabel={openLabel}
      cover={{ src: artworkUrl, alt: "", fallbackIcon: Radio, renderImage }}
      artworkOverlay={
        <InfoBadge
          surface="overlay"
          className="absolute left-2 top-2 max-w-[calc(100%-1rem)]"
        >
          {typeLabel}
        </InfoBadge>
      }
      subtitle={
        subtitle ? <MonoLabel as="span">{subtitle}</MonoLabel> : undefined
      }
      meta={
        playCount != null ? (
          <MonoLabel as="span">
            {t("common.playCount", { count: playCount })}
          </MonoLabel>
        ) : undefined
      }
      actionMenu={actionMenu}
      menuLabel={t("actions.menu.more")}
    />
  );
}
