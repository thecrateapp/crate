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
    <article className="group relative overflow-hidden rounded-[12px] border border-primary/10 bg-white/[0.025] p-4 text-left transition-colors hover:border-primary/25 hover:bg-white/[0.04]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_20%,rgba(6,182,212,0.22),transparent_34%),linear-gradient(90deg,rgba(255,255,255,0.06),transparent_58%)]" />
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
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,11,16,0.96),rgba(10,11,16,0.78)_48%,rgba(10,11,16,0.38)),linear-gradient(0deg,rgba(10,11,16,0.84),transparent_55%)]" />

      <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5">
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
              <div className="flex h-full w-full items-center justify-center text-primary">
                <Disc3 size={24} />
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
              <Disc3 size={11} />
              {badgeLabel}
            </div>
            <h3 className="truncate text-lg font-extrabold text-foreground">
              {item.title}
            </h3>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <Link
                to={artistPath}
                className="truncate transition-colors hover:text-foreground"
              >
                {item.artist}
              </Link>
              <span className="text-white/20">&middot;</span>
              <span className="truncate">{item.subtitle}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 md:justify-end">
          {dateStr ? (
            <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm font-semibold text-primary backdrop-blur">
              <Calendar size={14} />
              {dateStr}
            </div>
          ) : null}
          {albumPath ? (
            <Link
              to={albumPath}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Play size={14} className="fill-current" />
              {t("common.open")}
            </Link>
          ) : null}
          {countdown ? (
            <div className="rounded-lg border border-primary/15 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary backdrop-blur">
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
