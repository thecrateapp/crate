import { Link } from "react-router";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  Calendar,
  Disc3,
  MapPin,
  Play,
  RadioTower,
  Sparkles,
} from "@crate/ui/icons";

import {
  albumPagePath,
  artistBackgroundApiUrl,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import { CrateImage } from "@/components/artwork/CrateImage";

import type {
  HomeUpcomingInsight,
  HomeUpcomingItem,
  HomeUpcomingResponse,
} from "./home-model";
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

function insightLabel(type: HomeUpcomingInsight["type"], t: TFunction): string {
  if (type === "show_prep") return t("home.radar.insight.showPrep");
  if (type === "one_week") return t("home.radar.insight.thisWeek");
  return t("home.radar.insight.oneMonth");
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
  const { t, i18n } = useTranslation();
  const nextUpcoming = previewItems[0] || null;
  if (!nextUpcoming) {
    return (
      <section className="space-y-4">
        <SectionHeader
          title={t("home.radar.title")}
          subtitle={t("home.radar.subtitle")}
          actionLabel={t("home.radar.open")}
          onAction={onOpenUpcoming}
        />
        <div className="home-upcoming-empty-card rounded-[12px] p-5">
          <h2 className="text-lg font-bold text-foreground">
            {t("radar.empty.followTitle")}
          </h2>
          <p className="home-upcoming-empty-copy mt-1 max-w-2xl text-sm leading-6">
            {t("radar.empty.followBody")}
          </p>
        </div>
      </section>
    );
  }

  const isShow = nextUpcoming.type === "show";
  const nextUpcomingDate = formatUpcomingDate(nextUpcoming.date, i18n.language);
  const artistImage =
    resolveMaybeApiAssetUrl(nextUpcoming.cover_url) ||
    artistBackgroundApiUrl(
      {
        artistId: nextUpcoming.artist_id,
        artistSlug: nextUpcoming.artist_slug,
        artistName: nextUpcoming.artist,
      },
      { size: 1200 },
    ) ||
    artistPhotoApiUrl(
      {
        artistId: nextUpcoming.artist_id,
        artistSlug: nextUpcoming.artist_slug,
        artistName: nextUpcoming.artist,
      },
      { size: 800 },
    );
  const releasePath =
    !isShow &&
    (nextUpcoming.album_id ||
      nextUpcoming.release_id ||
      nextUpcoming.album_slug)
      ? albumPagePath({
          albumId: nextUpcoming.album_id
            ? nextUpcoming.album_id
            : nextUpcoming.release_id
              ? -nextUpcoming.release_id
              : undefined,
          albumSlug: nextUpcoming.album_id
            ? nextUpcoming.album_slug
            : undefined,
          albumName: nextUpcoming.title,
          artistSlug: nextUpcoming.album_id
            ? nextUpcoming.artist_slug
            : undefined,
          artistName: nextUpcoming.artist,
        })
      : null;
  const artistPath = artistPagePath({
    artistId: nextUpcoming.artist_id,
    artistSlug: nextUpcoming.artist_slug,
    artistName: nextUpcoming.artist,
  });

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.radar.title")}
        subtitle={t("home.radar.subtitle")}
        actionLabel={t("home.radar.open")}
        onAction={onOpenUpcoming}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <div className="home-upcoming-feature relative min-h-[270px] overflow-hidden rounded-[12px] p-5 sm:p-6">
          <div className="home-upcoming-feature-glow absolute inset-0" />
          {artistImage ? (
            <CrateImage
              src={artistImage}
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
                {isShow ? <RadioTower size={12} /> : <Disc3 size={12} />}
                {isShow
                  ? t("home.radar.badge.nextShow")
                  : t("home.radar.badge.nextRelease")}
              </div>

              <h2 className="max-w-3xl text-3xl font-extrabold leading-none tracking-tight text-foreground sm:text-4xl">
                {isShow ? nextUpcoming.artist : nextUpcoming.title}
              </h2>
              <p className="home-upcoming-feature-copy mt-3 max-w-2xl text-sm leading-6">
                {isShow
                  ? `${nextUpcoming.title} · ${nextUpcoming.subtitle}`
                  : `${nextUpcoming.artist} · ${nextUpcoming.subtitle}`}
              </p>
            </div>

            <div>
              <div className="mb-4 flex flex-wrap gap-2">
                {nextUpcomingDate ? (
                  <div className="home-upcoming-meta-card rounded-lg px-3 py-2 backdrop-blur">
                    <div className="home-upcoming-meta-label text-[10px] uppercase tracking-[0.16em]">
                      {t("home.radar.meta.date")}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-foreground">
                      {nextUpcomingDate}
                    </div>
                  </div>
                ) : null}
                {isShow && nextUpcoming.venue ? (
                  <div className="home-upcoming-meta-card rounded-lg px-3 py-2 backdrop-blur">
                    <div className="home-upcoming-meta-label text-[10px] uppercase tracking-[0.16em]">
                      {t("home.radar.meta.venue")}
                    </div>
                    <div className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                      <MapPin size={12} className="text-primary" />
                      {nextUpcoming.venue}
                    </div>
                  </div>
                ) : null}
                {nextUpcoming.user_attending && isShow ? (
                  <div className="home-upcoming-attending rounded-lg px-3 py-2 text-sm font-semibold backdrop-blur">
                    {t("radar.show.going")}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {isShow && onPlaySetlist ? (
                  <button
                    onClick={() => onPlaySetlist(nextUpcoming)}
                    disabled={!nextUpcoming.probable_setlist?.length}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Play size={15} className="fill-current" />
                    {t("radar.show.playSetlist")}
                  </button>
                ) : null}
                {!isShow && releasePath ? (
                  <Link
                    to={releasePath}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Play size={15} className="fill-current" />
                    {t("home.radar.openAlbum")}
                  </Link>
                ) : null}
                <button
                  onClick={onOpenUpcoming}
                  className="home-upcoming-secondary-action inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-foreground transition-colors"
                >
                  <Calendar size={15} />
                  {t("home.radar.viewRadar")}
                </button>
                {isShow && artistPath ? (
                  <Link
                    to={artistPath}
                    className="home-upcoming-secondary-action inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-foreground transition-colors"
                  >
                    {t("common.artist")}
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>

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
      </div>
    </section>
  );
}

export function HomeShowPrepSection({
  insights,
  onOpenUpcoming,
  onPlaySetlist,
  onSaveReminder,
}: {
  insights: HomeUpcomingInsight[];
  onOpenUpcoming: () => void;
  onPlaySetlist: (insight: HomeUpcomingInsight) => void;
  onSaveReminder: (insight: HomeUpcomingInsight) => void;
}) {
  const { t } = useTranslation();
  if (!insights.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title={t("home.radar.showPrep.title")}
        subtitle={t("home.radar.showPrep.subtitle")}
        actionLabel={t("home.radar.open")}
        onAction={onOpenUpcoming}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {insights.map((insight) => (
          <div
            key={`${insight.type}:${insight.show_id}`}
            className="home-upcoming-show-prep-card rounded-[12px] p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="home-upcoming-show-prep-badge inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em]">
                  <Sparkles size={12} />
                  {insightLabel(insight.type, t)}
                </div>
                <h3 className="mt-3 text-lg font-bold text-foreground">
                  {insight.title}
                </h3>
                <p className="home-upcoming-show-prep-subtitle mt-1 text-sm">
                  {insight.subtitle}
                </p>
              </div>
              {insight.weight === "high" ? (
                <div className="home-upcoming-show-prep-heavy rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.16em]">
                  {t("home.radar.showPrep.heavyRotation")}
                </div>
              ) : null}
            </div>

            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              {insight.message}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {insight.has_setlist ? (
                <button
                  onClick={() => onPlaySetlist(insight)}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Play size={14} fill="currentColor" />
                  {t("radar.show.playSetlist")}
                </button>
              ) : null}
              <button
                onClick={() => onSaveReminder(insight)}
                className="home-upcoming-show-prep-reminder inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors"
              >
                <Calendar size={14} />
                {t("home.radar.showPrep.saveForLater")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
