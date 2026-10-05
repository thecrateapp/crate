import { useTranslation } from "react-i18next";

import { PageHero } from "@crate/ui/domain/hero";
import {
  Calendar,
  CRATE_ICON_SIZE,
  Play,
  Radio,
  Share2,
} from "@crate/ui/icons";

import type { ItemActionMenuEntry } from "@/components/actions/ItemActionMenu";
import { CrateImage } from "@/components/artwork/CrateImage";
import { ListenHeroActionBar } from "@/components/hero/ListenHeroActionBar";
import type { UpcomingItem } from "@/components/upcoming/UpcomingRows";

import type { GenreDetail } from "./explore-model";

const GENRE_PRIMARY_ACTION_CLASS =
  "explore-genre-primary-action shadow-accent-action-glow hover:shadow-accent-action-strong disabled:cursor-wait disabled:opacity-70";

export interface GenreActionBarProps {
  albumCount: number;
  artistCount: number;
  data: GenreDetail;
  genreMenuActions: ItemActionMenuEntry[];
  heroCoverUrl: string | null;
  isDesktop: boolean;
  nextShow: UpcomingItem | null;
  onOpenGenreRadar: (show?: UpcomingItem | null) => void;
  onPlayGenreRadio: () => void;
  onShareGenre: () => void;
  startingRadio: boolean;
}

export interface GenreHeroProps {
  actionBar: GenreActionBarProps;
  artistCount: number;
  albumCount: number;
  data: GenreDetail;
  description: string;
  heroCoverUrl: string | null;
  onCoverError: () => void;
  trackCount: number;
}

function GenreActionBar({
  albumCount,
  artistCount,
  data,
  genreMenuActions,
  heroCoverUrl,
  isDesktop,
  nextShow,
  onOpenGenreRadar,
  onPlayGenreRadio,
  onShareGenre,
  startingRadio,
}: GenreActionBarProps) {
  const { t } = useTranslation();

  return (
    <ListenHeroActionBar
      primaryLabel={t("genre.actions.primaryGroup")}
      secondaryLabel={isDesktop ? t("genre.actions.secondaryGroup") : undefined}
      primaryActions={[
        {
          key: "radio",
          label: t("player.play"),
          icon: <Play size={CRATE_ICON_SIZE.md} fill="currentColor" />,
          onClick: onPlayGenreRadio,
          loading: startingRadio,
          ariaLabel: t("genre.actions.playRadio"),
          className: GENRE_PRIMARY_ACTION_CLASS,
        },
        ...(nextShow
          ? [
              {
                key: "next-show",
                label: t("genre.actions.nextShow"),
                icon: <Calendar size={CRATE_ICON_SIZE.md} />,
                tone: "neutral" as const,
                onClick: () => onOpenGenreRadar(nextShow),
                ariaLabel: t("genre.actions.openNextGenreShow"),
              },
            ]
          : []),
      ]}
      secondaryActions={
        isDesktop
          ? [
              {
                key: "share",
                label: t("common.share"),
                icon: <Share2 size={CRATE_ICON_SIZE.lg} />,
                onClick: onShareGenre,
                ariaLabel: t("genre.actions.share"),
              },
            ]
          : []
      }
      menu={{
        actions: genreMenuActions,
        header: {
          type: "media",
          title: data.name,
          subtitle: t("genre.kind"),
          detail: t("genre.menu.detail", {
            artists: artistCount,
            albums: albumCount,
          }),
          imageUrl: heroCoverUrl,
          imageAlt: data.name,
          imageShape: "square",
          fallbackIcon: Radio,
        },
      }}
    />
  );
}

export function GenreHero({
  actionBar,
  artistCount,
  albumCount,
  data,
  description,
  heroCoverUrl,
  onCoverError,
  trackCount,
}: GenreHeroProps) {
  const { t } = useTranslation();

  return (
    <PageHero
      variant="editorial"
      className="-mx-4 -mt-4 sm:-mx-6 sm:-mt-6 lg:-mt-8"
      title={data.name}
      description={description}
      meta={[
        t("common.artistCountLabel", { count: artistCount }),
        t("common.albumCountLabel", { count: albumCount }),
        t("common.trackCountLabel", { count: trackCount }),
      ]}
      background={{
        treatment: "vivid",
        render: (className) =>
          heroCoverUrl ? (
            <CrateImage
              key={heroCoverUrl}
              src={heroCoverUrl}
              alt={t("genre.coverAlt", { name: data.name })}
              decoding="async"
              fetchPriority="high"
              className={className}
              onError={onCoverError}
            />
          ) : null,
        overlay: (
          <>
            <div className="explore-genre-hero-scrim absolute inset-0" />
            <div className="explore-genre-hero-gradient absolute inset-0" />
          </>
        ),
      }}
      actionsClassName="mt-6 px-0 py-1 sm:px-0"
      actions={<GenreActionBar {...actionBar} />}
    />
  );
}
