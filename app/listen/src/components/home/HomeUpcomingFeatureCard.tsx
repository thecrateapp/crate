import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Calendar,
  CRATE_ICON_SIZE,
  Disc3,
  MapPin,
  Play,
  RadioTower,
} from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";

import { ArtworkSurface } from "@/components/artwork/ArtworkSurface";

import type { HomeUpcomingItem } from "./home-model";
import { buildUpcomingPresentation } from "./home-upcoming-model";

const LAZY_IMAGE_PROPS = { loading: "lazy" } as const;

function UpcomingFeatureMeta({
  item,
  isShow,
  date,
}: {
  item: HomeUpcomingItem;
  isShow: boolean;
  date: string | null;
}) {
  const { t } = useTranslation();

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {date ? (
        <div className="home-upcoming-meta-card rounded-lg px-3 py-2 backdrop-blur">
          <div className="home-upcoming-meta-label text-xs uppercase tracking-kicker">
            {t("home.radar.meta.date")}
          </div>
          <div className="mt-1 text-sm font-semibold text-text-primary">
            {date}
          </div>
        </div>
      ) : null}
      {isShow && item.venue ? (
        <div className="home-upcoming-meta-card rounded-lg px-3 py-2 backdrop-blur">
          <div className="home-upcoming-meta-label text-xs uppercase tracking-kicker">
            {t("home.radar.meta.venue")}
          </div>
          <div className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-text-primary">
            <MapPin
              size={CRATE_ICON_SIZE.micro}
              className="text-accent-action"
            />
            {item.venue}
          </div>
        </div>
      ) : null}
      {item.user_attending && isShow ? (
        <div className="home-upcoming-attending rounded-lg px-3 py-2 text-sm font-semibold backdrop-blur">
          {t("radar.show.going")}
        </div>
      ) : null}
    </div>
  );
}

function UpcomingFeatureActions({
  item,
  isShow,
  releasePath,
  artistPath,
  onOpenUpcoming,
  onPlaySetlist,
}: {
  item: HomeUpcomingItem;
  isShow: boolean;
  releasePath: string | null;
  artistPath: string;
  onOpenUpcoming: () => void;
  onPlaySetlist?: (item: HomeUpcomingItem) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isShow && onPlaySetlist ? (
        <Button
          size="sm"
          shape="pill"
          onClick={() => onPlaySetlist(item)}
          disabled={!item.probable_setlist?.length}
          className="h-9 gap-2 px-4 shadow-none has-[>svg]:px-4"
        >
          <Play size={CRATE_ICON_SIZE.sm} className="fill-current" />
          {t("radar.show.playSetlist")}
        </Button>
      ) : null}
      {!isShow && releasePath ? (
        <Button
          asChild
          size="sm"
          shape="pill"
          className="h-9 gap-2 px-4 shadow-none has-[>svg]:px-4"
        >
          <Link to={releasePath}>
            <Play size={CRATE_ICON_SIZE.sm} className="fill-current" />
            {t("home.radar.openAlbum")}
          </Link>
        </Button>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        shape="pill"
        onClick={onOpenUpcoming}
        className="home-upcoming-secondary-action h-9 gap-2 px-4 has-[>svg]:px-4"
      >
        <Calendar size={CRATE_ICON_SIZE.sm} />
        {t("home.radar.viewRadar")}
      </Button>
      {isShow ? (
        <Button
          asChild
          variant="secondary"
          size="sm"
          shape="pill"
          className="home-upcoming-secondary-action h-9 gap-2 px-4"
        >
          <Link to={artistPath}>{t("common.artist")}</Link>
        </Button>
      ) : null}
    </div>
  );
}

export function HomeUpcomingFeature({
  item,
  onOpenUpcoming,
  onPlaySetlist,
}: {
  item: HomeUpcomingItem;
  onOpenUpcoming: () => void;
  onPlaySetlist?: (item: HomeUpcomingItem) => void;
}) {
  const { t, i18n } = useTranslation();
  const presentation = buildUpcomingPresentation(item, i18n.language);

  return (
    <div className="home-upcoming-feature relative min-h-[270px] overflow-hidden rounded-panel p-5 sm:p-6">
      <div className="home-upcoming-feature-glow absolute inset-0" />
      {presentation.artistImage ? (
        <ArtworkSurface
          source={presentation.artistImage}
          alt=""
          fallback={null}
          imageProps={LAZY_IMAGE_PROPS}
          imageClassName="object-cover"
          className="absolute inset-0 opacity-40 grayscale"
        />
      ) : null}
      <div className="home-upcoming-feature-overlay absolute inset-0" />

      <div className="relative flex min-h-[222px] flex-col justify-between">
        <div>
          <div className="home-upcoming-badge mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium uppercase tracking-eyebrow">
            {presentation.isShow ? (
              <RadioTower size={CRATE_ICON_SIZE.micro} />
            ) : (
              <Disc3 size={CRATE_ICON_SIZE.micro} />
            )}
            {presentation.isShow
              ? t("home.radar.badge.nextShow")
              : t("home.radar.badge.nextRelease")}
          </div>

          <h2 className="max-w-3xl text-3xl font-extrabold leading-none tracking-tight text-text-primary sm:text-4xl">
            {presentation.isShow ? item.artist : item.title}
          </h2>
          <p className="home-upcoming-feature-copy mt-3 max-w-2xl text-sm leading-6">
            {presentation.isShow
              ? `${item.title} · ${item.subtitle}`
              : `${item.artist} · ${item.subtitle}`}
          </p>
        </div>

        <div>
          <UpcomingFeatureMeta
            item={item}
            isShow={presentation.isShow}
            date={presentation.date}
          />
          <UpcomingFeatureActions
            item={item}
            isShow={presentation.isShow}
            releasePath={presentation.releasePath}
            artistPath={presentation.artistPath}
            onOpenUpcoming={onOpenUpcoming}
            onPlaySetlist={onPlaySetlist}
          />
        </div>
      </div>
    </div>
  );
}
