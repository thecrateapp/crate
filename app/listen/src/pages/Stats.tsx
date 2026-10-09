import { Link } from "react-router";

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
import {
  AffinityCard,
  ScopeLink,
  StatsEmptyState,
} from "./StatsNarrativeSections";

export function Stats() {
  const page = useStatsPageController();
  return <StatsPageContent page={page} />;
}

function StatsPageContent({ page }: { page: StatsPageController }) {
  const { dashboard, dashboardLoading, hasStats, t } = page;
  const tape = dashboard?.tape;
  const highlights = dashboard?.highlights;
  return (
    <div className="pb-12">
      <StatsHeader page={page} />
      {!dashboardLoading && !hasStats ? (
        <StatsEmptyState t={t} />
      ) : (
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
          ) : dashboardLoading ? (
            <div className="stats-signal-skeleton" aria-hidden="true" />
          ) : null}
          <StatsActionBand page={page} />
          {dashboard?.artist_of_period ? (
            <StatsReveal className="mt-12">
              <StatsArtistOfPeriod artist={dashboard.artist_of_period} />
            </StatsReveal>
          ) : null}
          {highlights ? (
            <StatsReveal className="mt-4">
              <StatsHighlights highlights={highlights} />
            </StatsReveal>
          ) : null}
          {page.isGlobalStats && dashboard?.top_listeners?.length ? (
            <StatsReveal className="mt-10">
              <TopListenersPanel listeners={dashboard.top_listeners} />
            </StatsReveal>
          ) : null}
          <StatsReveal className="mt-10 grid gap-5 xl:grid-cols-2">
            <TopTracksPanel
              items={page.topTrackItems}
              rows={page.topTrackRows}
              loading={dashboardLoading}
              playSource={page.topTrackSource}
            />
            <TopArtistsPanel
              items={page.topArtistItems}
              loading={dashboardLoading}
            />
          </StatsReveal>
          <StatsReveal>
            <TopAlbumsPanel
              items={page.topAlbumItems}
              loading={dashboardLoading}
            />
          </StatsReveal>
          <StatsListeningSection page={page} />
          <StatsReveal className="mt-5 grid gap-5 lg:grid-cols-2">
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
      )}
    </div>
  );
}

function StatsListeningSection({ page }: { page: StatsPageController }) {
  const { dashboard, t } = page;
  return (
    <StatsReveal className="mt-10">
      <h2 className="mb-4 text-2xl font-extrabold tracking-tight text-text-primary">
        {t("stats.listening.title")}
      </h2>
      <div className="grid gap-5 lg:grid-cols-3">
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
      </div>
    </StatsReveal>
  );
}

function StatsHeader({ page }: { page: StatsPageController }) {
  const { t, isGlobalStats, isUserStats, username } = page;
  return (
    <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-x-3 text-base font-bold">
          {isUserStats ? (
            <>
              <span className="text-accent-action">{page.kicker}</span>
              {username ? (
                <>
                  <span aria-hidden="true" className="text-text-muted">
                    ·
                  </span>
                  <ScopeLink active={false} to={"/users/" + username}>
                    {t("stats.scope.backToProfile")}
                  </ScopeLink>
                </>
              ) : null}
            </>
          ) : (
            <>
              <ScopeLink active={!isGlobalStats} to="/stats">
                {t("stats.scope.yourDna")}
              </ScopeLink>
              <span aria-hidden="true" className="text-text-muted">
                ·
              </span>
              <ScopeLink active={isGlobalStats} to="/stats/global">
                {t("stats.scope.cratePulse")}
              </ScopeLink>
            </>
          )}
        </div>
        <h1 className="stats-signal-title mt-1">
          {page.signalTitle.lead}{" "}
          <span className="text-accent-action">{page.signalTitle.accent}</span>
        </h1>
      </div>
      <StatsPeriodPicker
        options={page.selectionOptions}
        value={page.selectedMonth ? null : page.selection}
        onChange={page.changeSelection}
      />
    </header>
  );
}

function StatsActionBand({ page }: { page: StatsPageController }) {
  const { t, isGlobalStats, isUserStats } = page;
  const showDigging = !isGlobalStats && !isUserStats && page.hasStats;
  const showReplay = page.replayItems.length > 0;
  if (!showDigging && !showReplay) return null;
  return (
    <section className="mt-10 flex flex-col gap-4 rounded-panel border border-border-quiet bg-surface-card p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      {showDigging ? (
        <div>
          <h2 className="text-lg font-bold text-text-primary">
            {t("stats.digging.band.title")}
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            {t("stats.digging.band.body")}
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 *:grow sm:*:grow-0">
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
      </div>
    </section>
  );
}
