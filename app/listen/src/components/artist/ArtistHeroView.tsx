import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Users } from "@crate/ui/icons";
import {
  ArtistHeroFrame,
  artistHeroArtworkFitClassName,
} from "@crate/ui/domain/ArtistHeroFrame";
import { ArtistBioText } from "@crate/ui/domain/ArtistBioText";
import { PageHero } from "@crate/ui/domain/hero";
import { SectionActionButton } from "@crate/ui/domain/lists/SectionHeader";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { formatCompact } from "../../lib/utils";

export interface ArtistHeroImageProps {
  src: string;
  alt: string;
  className: string;
  style?: CSSProperties;
}
/** Actual artist composition. App adapters retain image recovery, menus and playback authority. */
export function ArtistHeroView({
  name,
  bio,
  listeners,
  trackCount,
  albumCount,
  photoUrl,
  backgroundUrl,
  renderImage,
  actions,
  onOpenBio,
}: {
  name: string;
  bio: string;
  listeners?: number;
  trackCount: number;
  albumCount: number;
  photoUrl: string;
  backgroundUrl?: string;
  renderImage: (props: ArtistHeroImageProps) => ReactNode;
  actions: ReactNode;
  onOpenBio: () => void;
}) {
  const { t } = useTranslation();
  const heroBackgroundSrc = backgroundUrl;
  const mobileArtwork = photoUrl || heroBackgroundSrc;
  const artworkClassName = `absolute inset-0 size-full scale-[1.02] ${artistHeroArtworkFitClassName()} object-[right_20%]`;
  return (
    <PageHero
      variant="artist"
      title={name}
      titleClassName="mb-1 sm:mb-2"
      artwork={
        photoUrl
          ? renderImage({
              src: photoUrl,
              alt: name,
              className: "size-full object-cover",
            })
          : null
      }
      background={{
        overlay: <></>,
        render: () => (
          <>
            <div className="h-full sm:hidden">
              <ArtistHeroFrame
                composition="mobile"
                aspectRatio="auto"
                className="h-full"
                artwork={
                  mobileArtwork
                    ? renderImage({
                        src: mobileArtwork,
                        alt: "",
                        className: `${artworkClassName} brightness-[0.72] contrast-110 opacity-[0.82]`,
                      })
                    : null
                }
              />
            </div>
            <div className="hidden h-full sm:block">
              <ArtistHeroFrame
                composition="desktop"
                aspectRatio="auto"
                className="h-full"
                artwork={
                  heroBackgroundSrc
                    ? renderImage({
                        src: heroBackgroundSrc,
                        alt: "",
                        style: { objectPosition: "center calc(50% + 100px)" },
                        className: `${artworkClassName} grayscale brightness-[0.5] contrast-110 opacity-[0.45]`,
                      })
                    : null
                }
              />
            </div>
          </>
        ),
      }}
      meta={[
        listeners != null ? (
          <MonoLabel
            as="span"
            key="listeners"
            className="inline-flex items-center gap-1"
          >
            <Users size={CRATE_ICON_SIZE.xs} aria-hidden="true" />
            {t("artist.meta.listeners", { count: formatCompact(listeners) })}
          </MonoLabel>
        ) : null,
        <MonoLabel as="span" key="tracks">
          {t("common.trackCountLabel", { count: trackCount })}
        </MonoLabel>,
        <MonoLabel as="span" key="albums">
          {t("common.albumCountLabel", { count: albumCount })}
        </MonoLabel>,
      ]}
      actions={actions}
    >
      {bio ? (
        <div className="mt-3 max-w-2xl">
          <p className="line-clamp-2 whitespace-pre-line text-sm leading-relaxed text-text-primary/70 sm:line-clamp-3">
            <ArtistBioText text={bio} />
          </p>
          {bio.length > 200 ? (
            <SectionActionButton onClick={onOpenBio}>
              {t("common.showMore")}
            </SectionActionButton>
          ) : null}
        </div>
      ) : null}
    </PageHero>
  );
}
