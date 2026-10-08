import { useTranslation } from "react-i18next";
import { Flame, Repeat2, Search, CalendarDays } from "@crate/ui/icons";
import { PlayButton } from "@crate/ui/domain/media/PlayButton";

import type { StatsPageController } from "@/pages/use-stats-page-controller";
import { CrateImage } from "@/components/artwork/CrateImage";
import { TrackRow, type TrackRowData } from "@/components/cards/TrackRow";
import type { PlaySource } from "@/contexts/PlayerContext";
import {
  formatStatsMinutes,
  localizedReplaySubtitle,
  localizedReplayTitle,
  type ReplayMix,
  type StatsTrack,
} from "@/components/stats/stats-model";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { cn } from "@/lib/utils";
import { MiniStat, SignalCard } from "./StatsAnalyticsSections";
import { statsTrackKey } from "./stats-collection-keys";
import { CrateBadge } from "@crate/ui/primitives/CrateBadge";

const STATS_MOSAIC_CELL_IDS = [
  "top-left",
  "top-right",
  "middle-left",
  "middle-right",
  "bottom-left",
  "bottom-right",
  "footer-left",
  "footer-right",
] as const;

export function StatsHeroSection({ page }: { page: StatsPageController }) {
  return (
    <section className="mt-8 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
      <StatsHeroCover page={page} />
      <aside className="grid gap-4">
        <ReplayCard
          replay={page.replay}
          items={page.replayItems}
          rows={page.replayRows}
          playSource={page.replaySource}
          loading={page.dashboardLoading}
          onPlay={page.playReplay}
        />
        <StatsSignalCards page={page} />
      </aside>
    </section>
  );
}

function StatsHeroCover({ page }: { page: StatsPageController }) {
  const { leadArtist, leadGenre, overview, period, t } = page;

  return (
    <div className="stats-hero-surface relative min-h-hero-2xl overflow-hidden rounded-panel p-5 sm:p-7">
      <StatsCoverMosaic tracks={page.coverTracks} />
      <div className="stats-hero-overlay absolute inset-0" />
      <div className="relative z-10 flex min-h-hero-xl flex-col justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <CrateBadge size="md" surface="overlay">
            {period.label}
          </CrateBadge>
          <CrateBadge size="md" surface="overlay" icon={CalendarDays}>
            {period.title}
          </CrateBadge>
        </div>
        <div>
          <div className="stats-hero-title max-w-3xl text-[clamp(3.8rem,13vw,10rem)] font-black uppercase leading-[0.75] tracking-display">
            {leadGenre?.genre_name || leadArtist?.artist_name || "Crate"}
          </div>
          <div className="mt-5 grid max-w-3xl gap-3 sm:grid-cols-3">
            <HeroMetric
              label={t("stats.metrics.minutes")}
              value={formatStatsMinutes(overview?.minutes_listened ?? 0)}
            />
            <HeroMetric
              label={t("stats.metrics.plays")}
              value={overview?.play_count ? String(overview.play_count) : "0"}
            />
            <HeroMetric
              label={t("stats.metrics.activeDays")}
              value={overview?.active_days ? String(overview.active_days) : "0"}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatsSignalCards({ page }: { page: StatsPageController }) {
  const { leadArtist, leadTrack, t, topDiscovery } = page;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
      <SignalCard
        icon={Flame}
        label={t("stats.signals.obsession")}
        title={leadTrack?.title || t("stats.signals.noDominantTrack")}
        body={
          leadTrack
            ? t("stats.signals.dominantTrackBody", {
                artist: leadTrack.artist,
                count: leadTrack.play_count,
              })
            : t("stats.signals.noDominantTrackBody")
        }
      />
      <SignalCard
        icon={Search}
        label={
          topDiscovery
            ? t("stats.signals.discovery")
            : t("stats.signals.gravity")
        }
        title={
          topDiscovery?.artist_name ||
          leadArtist?.artist_name ||
          t("stats.signals.noLeadingArtist")
        }
        body={
          topDiscovery
            ? t("stats.signals.discoveryBody", {
                count: topDiscovery.play_count,
              })
            : leadArtist
              ? t("stats.signals.gravityBody", {
                  minutes: formatStatsMinutes(leadArtist.minutes_listened),
                  count: leadArtist.play_count,
                })
              : t("stats.signals.noLeadingArtistBody")
        }
      />
    </div>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-hero-metric rounded-lg px-4 py-3 backdrop-blur">
      <div className="stats-hero-metric-label text-xs font-black uppercase tracking-eyebrow-wide">
        {label}
      </div>
      <div className="stats-hero-metric-value mt-1 text-2xl font-black tracking-display">
        {value}
      </div>
    </div>
  );
}

function StatsCoverMosaic({ tracks }: { tracks: StatsTrack[] }) {
  const covers = tracks
    .flatMap((track) => {
      const cover = albumCoverApiUrl(
        {
          albumId: track.album_id,
          globalAlbumUid: track.global_album_uid,
          albumSlug: track.album_slug,
          artistName: track.artist,
          albumName: track.album,
        },
        { size: 512 },
      );
      return cover ? [cover] : [];
    })
    .slice(0, 8);

  return (
    <div className="absolute inset-0 grid grid-cols-2 opacity-80 sm:grid-cols-4">
      {STATS_MOSAIC_CELL_IDS.map((cellId, index) => {
        const cover = covers[index % Math.max(covers.length, 1)];
        return (
          <div
            key={cellId}
            className={cn(
              "stats-mosaic-cell relative min-h-40 overflow-hidden",
              index % 3 === 0 && "scale-105",
            )}
          >
            {cover ? (
              <CrateImage
                src={cover}
                alt=""
                className=" size-full object-cover grayscale-[35%] saturate-[0.85]"
                loading={index < 4 ? "eager" : "lazy"}
              />
            ) : (
              <div className="stats-mosaic-placeholder size-full" />
            )}
            <div className="stats-mosaic-overlay absolute inset-0" />
          </div>
        );
      })}
    </div>
  );
}

function ReplayCard({
  replay,
  items,
  loading,
  rows,
  playSource,
  onPlay,
}: {
  replay?: ReplayMix;
  items: StatsTrack[];
  rows: TrackRowData[];
  playSource: PlaySource;
  loading: boolean;
  onPlay: () => void;
}) {
  const { t } = useTranslation();
  const title = localizedReplayTitle(replay, t) || t("stats.replay.title");
  return (
    <div className="stats-replay-card rounded-panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <CrateBadge size="md" icon={Repeat2}>
            {t("stats.replay.title")}
          </CrateBadge>
          <h2 className="mt-3 text-2xl font-black tracking-display-tight text-text-primary">
            {title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-text-muted">
            {localizedReplaySubtitle(replay, t) ||
              t("stats.replay.defaultSubtitle")}
          </p>
        </div>
        <PlayButton
          onClick={onPlay}
          disabled={!items.length}
          label={t("common.playItem", {
            name: title,
          })}
          className="size-12"
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <MiniStat
          label={t("common.tracks")}
          value={String(replay?.track_count ?? 0)}
        />
        <MiniStat
          label={t("stats.metrics.minutes")}
          value={formatStatsMinutes(replay?.minutes_listened ?? 0)}
        />
      </div>

      <div className="mt-5 space-y-1">
        {loading ? (
          <div className="stats-card-empty rounded-lg border border-dashed px-4 py-5 text-sm">
            {t("stats.replay.loading")}
          </div>
        ) : items.length ? (
          items
            .slice(0, 5)
            .map((item, index) => (
              <TrackRow
                key={statsTrackKey(item)}
                track={rows[index]!}
                rank={index + 1}
                density="compact"
                showCoverThumb
                showArtist
                showLike={false}
                showDuration={false}
                queueTracks={rows}
                playSource={playSource}
              />
            ))
        ) : (
          <div className="stats-card-empty rounded-lg border border-dashed px-4 py-5 text-sm">
            {t("stats.replay.empty")}
          </div>
        )}
      </div>
    </div>
  );
}
