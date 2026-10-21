import { useState } from "react";
import { statsDashboardReadState } from "./stats-page-model";
import { Link } from "react-router";
import {
  StatsHeaderView,
  StatsPageView,
  StatsRankings,
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
import { StatsMusicAgeCard } from "@/components/stats/StatsClosingCards";
import { StatsMovement } from "@/components/stats/StatsMovement";
import { statsMovementNewArtists } from "@/components/stats/StatsMovementView";
import { StatsExplorer } from "@/components/stats/explorer/StatsExplorer";
import { StatsGenreTrendCard } from "@/components/stats/StatsGenreTrendCard";
import { StatsFreshness } from "@/components/stats/StatsFreshness";
import { StatsHeadlineNumbers } from "@/components/stats/StatsHeadlineNumbers";
import { ListeningHeatmap } from "@/components/stats/ListeningHeatmap";
import { heatmapTopGenre } from "@/components/stats/heatmap-model";
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

/** Whose stats these are: the viewer's own, another listener's or the instance. */
function statsScope(page: StatsPageController): "personal" | "user" | "global" {
  if (page.isUserStats) return "user";
  return page.isGlobalStats ? "global" : "personal";
}

/** Artists already featured above Movement: the hero and the top three. */
function movementExclusions(page: StatsPageController): string[] {
  const names = page.topArtistItems.slice(0, 3).map((a) => a.artist_name);
  const hero = page.dashboard?.artist_of_period?.artist_name;
  return hero ? [hero, ...names] : names;
}

/** `#movement` only while its New column shows someone after the exclusions. */
function newArtistsHref(page: StatsPageController): string | undefined {
  const story = page.dashboard?.story;
  if (!story) return undefined;
  const visible = statsMovementNewArtists(
    story,
    movementExclusions(page),
    statsScope(page),
  );
  return visible.length ? "#movement" : undefined;
}

function StatsPageContent({ page }: { page: StatsPageController }) {
  const { dashboard, dashboardLoading, hasStats } = page;
  const tape = dashboard?.tape;
  const highlights = dashboard?.highlights;
  const comparison = statsComparison(page);
  // The sections remount while an uncached period loads, and the three Stats
  // routes share this mounted page. One flag per subject outlives both, so
  // each subject's heatmap wave plays once per page session (R28).
  const [heatmapEntrances] = useState(
    () => new Map<string, { current: boolean }>(),
  );
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
                <StatsHighlights
                  highlights={highlights}
                  allTime={page.selection === "all_time"}
                  newArtistsHref={newArtistsHref(page)}
                />
              </StatsReveal>
            ) : null
          }
        />
        {dashboard?.story ? (
          <StatsReveal>
            <StatsMovement
              story={dashboard.story}
              exclude={movementExclusions(page)}
              scope={statsScope(page)}
            />
          </StatsReveal>
        ) : null}
        {page.isGlobalStats && dashboard?.top_listeners?.length ? (
          <StatsReveal>
            <TopListenersPanel listeners={dashboard.top_listeners} />
          </StatsReveal>
        ) : null}
        <StatsReveal>
          <StatsRankings>
            <TopTracksPanel
              items={page.topTrackItems}
              rows={page.topTrackRows}
              loading={dashboardLoading && !dashboard}
              playSource={page.topTrackSource}
            />
            <TopArtistsPanel
              items={page.topArtistItems}
              loading={dashboardLoading && !dashboard}
              totalMinutes={page.overview?.minutes_listened ?? 0}
            />
          </StatsRankings>
        </StatsReveal>
        <StatsReveal>
          <TopAlbumsPanel
            items={page.topAlbumItems}
            loading={dashboardLoading && !dashboard}
          />
        </StatsReveal>
        <StatsListeningSection page={page} entrances={heatmapEntrances} />
        {dashboard?.music_age ? (
          <StatsReveal>
            <StatsMusicAgeCard
              musicAge={dashboard.music_age}
              tape={dashboard.tape}
            />
          </StatsReveal>
        ) : null}
        <AffinityCard
          affinity={dashboard?.viewer_affinity}
          subject={page.subjectName}
        />
      </>
    </StatsPageView>
  );
}

/** The entrance flag of one subject, created on first use. */
function heatmapEntranceFor(
  entrances: Map<string, { current: boolean }>,
  subject: string,
) {
  let entrance = entrances.get(subject);
  if (!entrance) {
    entrance = { current: false };
    entrances.set(subject, entrance);
  }
  return entrance;
}

function StatsListeningSection({
  page,
  entrances,
}: {
  page: StatsPageController;
  entrances: Map<string, { current: boolean }>;
}) {
  const { dashboard } = page;
  const scope = statsScope(page);
  // R28: a new subject gets a fresh band (its own peak, readout and focus).
  const subject = `${scope}:${page.username ?? ""}`;
  return (
    <StatsReveal>
      <StatsListeningView
        band={
          <ListeningHeatmap
            key={subject}
            heatmap={dashboard?.heatmap}
            timezone={dashboard?.timezone}
            showNow={scope === "personal"}
            scope={scope}
            topGenre={heatmapTopGenre(
              page.topGenreItems,
              dashboard?.genre_trend,
            )}
            loading={page.dashboardLoading && !dashboard}
            pending={dashboard?.snapshot?.pending === true}
            entranceRef={heatmapEntranceFor(entrances, subject)}
          />
        }
      >
        <SoundProfileCard
          profile={page.soundProfile}
          previousProfile={page.previousSoundProfile}
          favourite={page.energeticFavourite}
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
      scope={statsScope(page)}
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
      diggingAction={
        showDigging ? (
          <Button asChild>
            <Link
              to={`/stats/digging?window=${encodeURIComponent(page.selection)}`}
            >
              <Sparkles size={CRATE_ICON_SIZE.sm} />
              {t("stats.digging.open")}
            </Link>
          </Button>
        ) : undefined
      }
      replay={
        page.replay && showReplay ? (
          <StatsReplayCard
            replay={page.replay}
            onPlay={page.playReplay}
            onShuffle={page.shuffleReplay}
            coverUrl={replayCoverUrl}
            renderImage={renderReplayCover}
          />
        ) : undefined
      }
    />
  );
}
