import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Calendar, Disc3, MapPin, Play, RadioTower } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import {
  albumPagePath,
  artistBackgroundApiUrl,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

import type { HomeUpcomingItem, HomeUpcomingResponse } from "./home-model";
import { SectionHeader, UpcomingPreviewRow } from "./HomeSections";

function formatUpcomingDate(
  date: string | undefined,
  locale: string,
): string | null {
  if (!date) return null;
  return new Date(`${date}T12:00:00`).toLocaleDateString(locale, {
    month: "long",
    day: "numeric",
  });
}

function buildUpcomingPresentation(item: HomeUpcomingItem, locale: string) {
  const isShow = item.type === "show";
  const date = formatUpcomingDate(item.date, locale);
  const artistImage =
    resolveMaybeApiAssetUrl(item.cover_url) ||
    artistBackgroundApiUrl(
      {
        artistId: item.artist_id,
        artistSlug: item.artist_slug,
        artistName: item.artist,
      },
      { size: 1200 },
    ) ||
    artistPhotoApiUrl(
      {
        artistId: item.artist_id,
        artistSlug: item.artist_slug,
        artistName: item.artist,
      },
      { size: 800 },
    );
  const releasePath =
    !isShow && (item.album_id || item.release_id || item.album_slug)
      ? albumPagePath({
          albumId: item.album_id
            ? item.album_id
            : item.release_id
              ? -item.release_id
              : undefined,
          albumSlug: item.album_id ? item.album_slug : undefined,
          albumName: item.title,
          artistSlug: item.album_id ? item.artist_slug : undefined,
          artistName: item.artist,
        })
      : null;

  return {
    isShow,
    date,
    artistImage,
    releasePath,
    artistPath: artistPagePath({
      artistId: item.artist_id,
      artistSlug: item.artist_slug,
      artistName: item.artist,
    }),
  };
}

function HomeUpcomingEmpty({ onOpenUpcoming }: { onOpenUpcoming: () => void }) {
  const { t } = useTranslation();

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.radar.title")}
        subtitle={t("home.radar.subtitle")}
        actionLabel={t("home.radar.open")}
        onAction={onOpenUpcoming}
      />
      <div className="home-upcoming-empty-card rounded-[12px] p-5">
        <h2 className="text-lg font-bold text-text-primary">
          {t("radar.empty.followTitle")}
        </h2>
        <p className="home-upcoming-empty-copy mt-1 max-w-2xl text-sm leading-6">
          {t("radar.empty.followBody")}
        </p>
      </div>
    </section>
  );
}

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
          <div className="home-upcoming-meta-label text-[10px] uppercase tracking-[0.16em]">
            {t("home.radar.meta.date")}
          </div>
          <div className="mt-1 text-sm font-semibold text-text-primary">
            {date}
          </div>
        </div>
      ) : null}
      {isShow && item.venue ? (
        <div className="home-upcoming-meta-card rounded-lg px-3 py-2 backdrop-blur">
          <div className="home-upcoming-meta-label text-[10px] uppercase tracking-[0.16em]">
            {t("home.radar.meta.venue")}
          </div>
          <div className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-text-primary">
            <MapPin size={12} className="text-accent-action" />
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
        <button
          type="button"
          onClick={() => onPlaySetlist(item)}
          disabled={!item.probable_setlist?.length}
          className="inline-flex items-center gap-2 rounded-full bg-accent-action px-4 py-2 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play size={15} className="fill-current" />
          {t("radar.show.playSetlist")}
        </button>
      ) : null}
      {!isShow && releasePath ? (
        <Link
          to={releasePath}
          className="inline-flex items-center gap-2 rounded-full bg-accent-action px-4 py-2 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90"
        >
          <Play size={15} className="fill-current" />
          {t("home.radar.openAlbum")}
        </Link>
      ) : null}
      <button
        type="button"
        onClick={onOpenUpcoming}
        className="home-upcoming-secondary-action inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-text-primary transition-colors"
      >
        <Calendar size={15} />
        {t("home.radar.viewRadar")}
      </button>
      {isShow ? (
        <Link
          to={artistPath}
          className="home-upcoming-secondary-action inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-text-primary transition-colors"
        >
          {t("common.artist")}
        </Link>
      ) : null}
    </div>
  );
}

function HomeUpcomingFeature({
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
    <div className="home-upcoming-feature relative min-h-[270px] overflow-hidden rounded-[12px] p-5 sm:p-6">
      <div className="home-upcoming-feature-glow absolute inset-0" />
      {presentation.artistImage ? (
        <CrateImage
          src={presentation.artistImage}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover opacity-40 grayscale"
          onError={(event) => {
            (event.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : null}
      <div className="home-upcoming-feature-overlay absolute inset-0" />

      <div className="relative flex min-h-[222px] flex-col justify-between">
        <div>
          <div className="home-upcoming-badge mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em]">
            {presentation.isShow ? (
              <RadioTower size={12} />
            ) : (
              <Disc3 size={12} />
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

function HomeUpcomingPreviewPanel({
  previewItems,
  summary,
  onOpenUpcoming,
}: {
  previewItems: HomeUpcomingItem[];
  summary?: HomeUpcomingResponse["summary"];
  onOpenUpcoming: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="home-upcoming-panel overflow-hidden rounded-[12px] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="home-upcoming-panel-kicker flex items-center gap-2 text-[11px] uppercase tracking-wider">
          <Calendar size={12} />
          {t("home.radar.nextUp")}
        </div>
        <div className="home-upcoming-summary text-[10px] uppercase tracking-[0.16em]">
          {t("home.radar.summary", {
            shows: summary?.show_count ?? 0,
            releases: summary?.release_count ?? 0,
          })}
        </div>
      </div>
      <div className="space-y-1">
        {previewItems.slice(1).map((item) => (
          <UpcomingPreviewRow
            key={`${item.type}-${item.artist}-${item.title}-${item.date}`}
            item={item}
            onClick={onOpenUpcoming}
          />
        ))}
      </div>
    </div>
  );
}

export function HomeUpcomingSection({
  previewItems,
  summary,
  onOpenUpcoming,
  onPlaySetlist,
}: {
  previewItems: HomeUpcomingItem[];
  summary?: HomeUpcomingResponse["summary"];
  onOpenUpcoming: () => void;
  onPlaySetlist?: (item: HomeUpcomingItem) => void;
}) {
  const { t } = useTranslation();
  const nextUpcoming = previewItems[0];

  if (!nextUpcoming)
    return <HomeUpcomingEmpty onOpenUpcoming={onOpenUpcoming} />;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.radar.title")}
        subtitle={t("home.radar.subtitle")}
        actionLabel={t("home.radar.open")}
        onAction={onOpenUpcoming}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <HomeUpcomingFeature
          item={nextUpcoming}
          onOpenUpcoming={onOpenUpcoming}
          onPlaySetlist={onPlaySetlist}
        />
        <HomeUpcomingPreviewPanel
          previewItems={previewItems}
          summary={summary}
          onOpenUpcoming={onOpenUpcoming}
        />
      </div>
    </section>
  );
}
