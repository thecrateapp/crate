import { statsDashboardReadState } from "./stats-page-model";
import { Link } from "react-router";
import {
  StatsHeaderView,
  StatsPageView,
  StatsActionBandView,
  StatsEditorialStack,
  StatsListeningView,
} from "./StatsPageView";

import { CRATE_ICON_SIZE, Sparkles } from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";

import type { MediaCoverProps } from "@crate/ui/domain/media/MediaCover";

import { CrateImage } from "@/components/artwork/CrateImage";
import type { StatsTrack } from "@/components/stats/stats-types";
import { albumCoverApiUrl } from "@/lib/library-routes";
import { StatsArtistOfPeriod } from "@/components/stats/StatsArtistOfPeriod";
import {
  StatsDiscoveriesCard,
  StatsMusicAgeCard,
} from "@/components/stats/StatsClosingCards";
import { StatsExplorer } from "@/components/stats/explorer/StatsExplorer";
import { StatsGenreTrendCard } from "@/components/stats/StatsGenreTrendCard";
import { StatsFreshness } from "@/components/stats/StatsFreshness";
import { StatsHeadlineNumbers } from "@/components/stats/StatsHeadlineNumbers";
import { StatsHeatmapCard } from "@/components/stats/StatsHeatmapCard";
import { StatsHighlights } from "@/components/stats/StatsHighlights";
import { StatsReplayCard } from "@/components/stats/StatsReplayCard";
import { StatsPeriodPicker } from "@/components/stats/StatsPeriodPicker";
import { StatsReveal } from "@/components/stats/StatsReveal";
import {
  useStatsPageController,
  type StatsPageController,
} from "@/pages/use-stats-page-controller";

import { SoundProfileCard } from "./StatsAnalyticsSections";
import {
  TopAlbumsPanel,
  TopArtistsPanel,
  TopListenersPanel,
  TopTracksPanel,
} from "./StatsCollectionPanels";
import { AffinityCard } from "./StatsNarrativeSections";

function replayCoverUrl(track: StatsTrack): string | null {
  if (!track.album) return null;
  return (
    albumCoverApiUrl(
      {
        albumId: track.album_id,
        globalAlbumUid: track.global_album_uid,
        albumName: track.album,
        artistName: track.artist,
      },
      { size: 128 },
    ) || null
  );
}

const renderReplayCover: MediaCoverProps["renderImage"] = ({
  src,
  alt,
  className,
  onError,
}) => (
  <CrateImage
    src={src}
    alt={alt}
    className={className}
    onError={onError}
    loading="lazy"
  />
);

export function Stats() {
  const page = useStatsPageController();
  return <StatsPageContent page={page} />;
}

function statsComparison(page: StatsPageController) {
  const { selection, selectedMonth, t } = page;
  if (!selectedMonth && selection === "all_time") return null;
  let caption: string;
  if (selectedMonth) caption = t("stats.compare.vsPreviousMonth");
  else if (selection === "365d" || selection.startsWith("year:"))
    caption = t("stats.compare.vsPreviousYear");
  else {
    const days = selection.replace(/d$/, "");
    caption = t("stats.compare.vsPrevious", {
      period: t(`stats.period.${days}d`),
    });
  }
  return { previous: page.overview?.previous ?? null, caption };
}

function StatsPageContent({ page }: { page: StatsPageController }) {
  const { dashboard, dashboardLoading, hasStats } = page;
  const tape = dashboard?.tape;
  const highlights = dashboard?.highlights;
  const comparison = statsComparison(page);
  return (
    <StatsPageView
      header={<StatsHeader page={page} />}
      readState={statsDashboardReadState(
        dashboard,
        page.dashboardLoading,
        page.dashboardError,
      )}
      empty={!hasStats}
      onRetry={page.retryDashboard}
    >
      <>
        <StatsHeadlineNumbers
          minutes={page.overview?.minutes_listened ?? 0}
          plays={page.overview?.play_count ?? 0}
          activeDays={page.overview?.active_days ?? 0}
          artists={highlights?.artist_count ?? null}
          today={page.today}
          comparison={comparison}
        />
        {tape?.points.length ? (
          <StatsExplorer
            tape={tape}
            selection={
              page.selectedMonth
                ? `month:${page.selectedMonth}`
                : page.selection
            }
            rangeEndpoint={page.rangeEndpoint}
          />
        ) : dashboardLoading && !dashboard ? (
          <div className="stats-signal-skeleton" aria-hidden="true" />
        ) : null}
        <StatsActionBand page={page} />
        <StatsEditorialStack
          artist={
            dashboard?.artist_of_period ? (
              <StatsReveal>
                <StatsArtistOfPeriod
                  artist={dashboard.artist_of_period}
                  periodStart={dashboard.tape?.start}
                  allTime={page.selection === "all_time"}
                />
              </StatsReveal>
            ) : null
          }
          highlights={
            highlights ? (
              <StatsReveal>
                <StatsHighlights highlights={highlights} />
              </StatsReveal>
            ) : null
          }
        />
        {page.isGlobalStats && dashboard?.top_listeners?.length ? (
          <StatsReveal>
            <TopListenersPanel listeners={dashboard.top_listeners} />
          </StatsReveal>
        ) : null}
        <StatsReveal className="grid gap-5 xl:grid-cols-2">
          <TopTracksPanel
            items={page.topTrackItems}
            rows={page.topTrackRows}
            loading={dashboardLoading && !dashboard}
            playSource={page.topTrackSource}
          />
          <TopArtistsPanel
            items={page.topArtistItems}
            loading={dashboardLoading && !dashboard}
            heroArtistName={dashboard?.artist_of_period?.artist_name}
            totalMinutes={page.overview?.minutes_listened ?? 0}
          />
        </StatsReveal>
        <StatsReveal>
          <TopAlbumsPanel
            items={page.topAlbumItems}
            loading={dashboardLoading && !dashboard}
          />
        </StatsReveal>
        <StatsListeningSection page={page} />
        <StatsReveal className="grid gap-5 lg:grid-cols-2">
          {dashboard?.music_age ? (
            <StatsMusicAgeCard musicAge={dashboard.music_age} />
          ) : null}
          <StatsDiscoveriesCard discoveries={page.discoveries} />
        </StatsReveal>
        <AffinityCard
          affinity={dashboard?.viewer_affinity}
          subject={page.subjectName}
        />
      </>
    </StatsPageView>
  );
}

function StatsListeningSection({ page }: { page: StatsPageController }) {
  const { dashboard } = page;
  return (
    <StatsReveal>
      <StatsListeningView>
        {dashboard?.heatmap ? (
          <StatsHeatmapCard heatmap={dashboard.heatmap} />
        ) : null}
        <SoundProfileCard
          profile={page.soundProfile}
          genres={[]}
          skipRate={page.overview?.skip_rate ?? 0}
          hideGenres
        />
        {dashboard?.genre_trend?.length ? (
          <StatsGenreTrendCard genres={dashboard.genre_trend} />
        ) : null}
      </StatsListeningView>
    </StatsReveal>
  );
}

function StatsHeader({ page }: { page: StatsPageController }) {
  return (
    <StatsHeaderView
      title={
        <>
          {page.signalTitle.lead}{" "}
          <span className="text-accent-action-hi">
            {page.signalTitle.accent}
          </span>
        </>
      }
      scope={
        page.isUserStats ? "user" : page.isGlobalStats ? "global" : "personal"
      }
      kicker={page.kicker}
      freshness={
        <StatsFreshness
          snapshot={page.dashboard?.snapshot}
          computedUntil={page.dashboard?.computed_until}
          provisional={page.dashboard?.provisional}
        />
      }
      profileHref={page.username ? `/users/${page.username}` : undefined}
      period={
        <StatsPeriodPicker
          options={page.selectionOptions}
          value={page.selectedMonth ? null : page.selection}
          onChange={page.changeSelection}
        />
      }
    />
  );
}

function StatsActionBand({ page }: { page: StatsPageController }) {
  const { t, isGlobalStats, isUserStats } = page;
  const showDigging = !isGlobalStats && !isUserStats && page.hasStats;
  const showReplay = page.replayItems.length > 0;
  if (!showDigging && !showReplay) return null;
  return (
    <StatsActionBandView
      showDigging={showDigging}
      actions={
        <>
          {showDigging ? (
            <Button asChild>
              <Link
                to={`/stats/digging?window=${encodeURIComponent(page.selection)}`}
              >
                <Sparkles size={CRATE_ICON_SIZE.sm} />
                {t("stats.digging.open")}
              </Link>
            </Button>
          ) : null}
          {page.replay && showReplay ? (
            <StatsReplayCard
              replay={page.replay}
              onPlay={page.playReplay}
              onShuffle={page.shuffleReplay}
              coverUrl={replayCoverUrl}
              renderImage={renderReplayCover}
            />
          ) : null}
        </>
      }
    />
  );
}
