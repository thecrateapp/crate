import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PageHero } from "@crate/ui/domain/hero";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
/** The actual genre hero presentation; managed artwork and action authority are injected. */
export function GenreHeroView({
  name,
  description,
  artistCount,
  albumCount,
  trackCount,
  renderImage,
  actions,
}: {
  name: string;
  description: string;
  artistCount: number;
  albumCount: number;
  trackCount: number;
  renderImage?: (className: string) => ReactNode;
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <PageHero
      variant="editorial"
      bleed
      title={name}
      description={description}
      meta={[
        <MonoLabel as="span" key="artists">
          {t("common.artistCountLabel", { count: artistCount })}
        </MonoLabel>,
        <MonoLabel as="span" key="albums">
          {t("common.albumCountLabel", { count: albumCount })}
        </MonoLabel>,
        <MonoLabel as="span" key="tracks">
          {t("common.trackCountLabel", { count: trackCount })}
        </MonoLabel>,
      ]}
      background={{
        treatment: "vivid",
        render: (className) => renderImage?.(className) ?? null,
        overlay: (
          <>
            <div className="explore-genre-hero-scrim absolute inset-0" />
            <div className="explore-genre-hero-gradient absolute inset-0" />
          </>
        ),
      }}
      actions={actions}
    />
  );
}
