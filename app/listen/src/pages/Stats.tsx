import { statsDashboardReadState } from "./stats-page-model";
import { Link } from "react-router";
import {
  StatsHeaderView,
  StatsPageView,
  StatsActionBandView,
  StatsEditorialStack,
  StatsListeningView,
} from "./StatsPageView";

import { CRATE_ICON_SIZE, Play, Sparkles } from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";

import { StatsArtistOfPeriod } from "@/components/stats/StatsArtistOfPeriod";
import {
  StatsDiscoveriesCard,
  StatsMusicAgeCard,
} from "@/components/stats/StatsClosingCards";
import { StatsGenreTrendCard } from "@/components/stats/StatsGenreTrendCard";
import { StatsHeadlineNumbers } from "@/components/stats/StatsHeadlineNumbers";
import { StatsHeatmapCard } from "@/components/stats/StatsHeatmapCard";
import { StatsHighlights } from "@/components/stats/StatsHighlights";
import { StatsPeriodPicker } from "@/components/stats/StatsPeriodPicker";
import { StatsReveal } from "@/components/stats/StatsReveal";
import { StatsSignalTape } from "@/components/stats/StatsSignalTape";
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

export function Stats() {
  const page = useStatsPageController();
  return <StatsPageContent page={page} />;
}

function StatsPageContent({ page }: { page: StatsPageController }) {
  const { dashboard, dashboardLoading, hasStats } = page;
  const tape = dashboard?.tape;
  const highlights = dashboard?.highlights;
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
        />
        {tape?.points.length ? (
          <StatsSignalTape tape={tape} />
        ) : dashboardLoading && !dashboard ? (
          <div className="stats-signal-skeleton" aria-hidden="true" />
        ) : null}
        <StatsActionBand page={page} />
        <StatsEditorialStack
          artist={
            dashboard?.artist_of_period ? (
              <StatsReveal>
                <StatsArtistOfPeriod artist={dashboard.artist_of_period} />
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
          {showReplay ? (
            <Button type="button" variant="outline" onClick={page.playReplay}>
              <Play size={CRATE_ICON_SIZE.sm} />
              {t("stats.signal.playReplay")}
            </Button>
          ) : null}
        </>
      }
    />
  );
}
