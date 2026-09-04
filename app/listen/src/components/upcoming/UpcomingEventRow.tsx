import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Calendar, Disc3, Play } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import {
  albumPagePath,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

import {
  canOpenUpcomingRelease,
  upcomingCountdown,
  type UpcomingItem,
} from "./upcoming-model";

export function UpcomingEventRow({ item }: { item: UpcomingItem }) {
  const { t, i18n } = useTranslation();
  const dateObj = item.date ? new Date(`${item.date}T12:00:00`) : null;
  const dateStr = dateObj
    ? dateObj.toLocaleDateString(i18n.language, {
        month: "short",
        day: "numeric",
      })
    : "";
  const coverUrl =
    resolveMaybeApiAssetUrl(item.cover_url) ||
    artistPhotoApiUrl(
      {
        artistId: item.artist_id,
        artistSlug: item.artist_slug,
        artistName: item.artist,
      },
      { size: 800 },
    ) ||
    undefined;
  const badgeLabel = item.is_upcoming
    ? t("radar.release.preRelease")
    : t("radar.release.released");
  const countdown = upcomingCountdown(item.date, item.time);
  const useVirtualAlbumRoute =
    !item.album_id && item.release_id != null && item.release_id > 0;
  const virtualAlbumId = useVirtualAlbumRoute ? item.release_id : null;
  const albumPath =
    canOpenUpcomingRelease(item) &&
    (item.album_id || item.album_slug || item.release_id)
      ? albumPagePath({
          albumId:
            item.album_id ??
            (virtualAlbumId != null ? -virtualAlbumId : undefined),
          albumSlug: useVirtualAlbumRoute ? undefined : item.album_slug,
          albumName: item.title,
          artistSlug: useVirtualAlbumRoute ? undefined : item.artist_slug,
          artistName: item.artist,
        })
      : null;
  const artistPath = artistPagePath({
    artistId: item.artist_id,
    artistSlug: item.artist_slug,
    artistName: item.artist,
  });

  return (
    <article className="group relative overflow-hidden rounded-[12px] border border-accent-action/10 bg-text-primary/[0.025] p-4 text-left transition-colors hover:border-accent-action/25 hover:bg-text-primary/[0.04]">
      <div className="upcoming-event-row-atmosphere absolute inset-0" />
      {coverUrl ? (
        <CrateImage
          src={coverUrl}
          alt=""
          loading="lazy"
          className="absolute inset-y-0 right-0 h-full w-1/2 object-cover opacity-[0.24] grayscale transition-opacity group-hover:opacity-[0.34]"
          onError={(event) => {
            (event.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : null}
      <div className="upcoming-event-row-scrim absolute inset-0" />

      <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl border border-border-quiet bg-text-primary/5">
            {coverUrl ? (
              <CrateImage
                src={coverUrl}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
                onError={(event) => {
                  (event.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-accent-action">
                <Disc3 size={24} />
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-accent-action/15 bg-accent-action/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-accent-action">
              <Disc3 size={11} />
              {badgeLabel}
            </div>
            <h3 className="truncate text-lg font-extrabold text-text-primary">
              {item.title}
            </h3>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
              <Link
                to={artistPath}
                className="truncate transition-colors hover:text-text-primary"
              >
                {item.artist}
              </Link>
              <span className="text-text-primary/20">&middot;</span>
              <span className="truncate">{item.subtitle}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 md:justify-end">
          {dateStr ? (
            <div className="inline-flex items-center gap-2 rounded-lg border border-border-quiet bg-text-primary/[0.06] px-3 py-2 text-sm font-semibold text-accent-action backdrop-blur">
              <Calendar size={14} />
              {dateStr}
            </div>
          ) : null}
          {albumPath ? (
            <Link
              to={albumPath}
              className="inline-flex items-center gap-2 rounded-full bg-accent-action px-3.5 py-2 text-sm font-medium text-accent-action-foreground transition-colors hover:bg-accent-action/90"
            >
              <Play size={14} className="fill-current" />
              {t("common.open")}
            </Link>
          ) : null}
          {countdown ? (
            <div className="rounded-lg border border-accent-action/15 bg-accent-action/10 px-3 py-2 text-sm font-semibold text-accent-action backdrop-blur">
              {countdown.unit === "hours"
                ? t("radar.show.time.hoursToGo", { count: countdown.value })
                : t("radar.show.time.daysToGo", { count: countdown.value })}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
