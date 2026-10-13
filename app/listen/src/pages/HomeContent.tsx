import {
  EssentialsSection,
  FavoriteArtistsSection,
  HomeTasteHero,
  openRecentItemPath,
  RecentlyPlayedSection,
  RecommendedTracksSection,
  SuggestedAlbumsSection,
  UpcomingAlbumsSection,
} from "@/components/home/HomeDiscoverySections";
import { JustLandedSection } from "@/components/home/HomeLibrarySections";
import {
  HomeReplaySection,
  type HomeListeningSignal,
} from "@/components/home/HomePlaybackSections";
import type { StatsDashboard } from "@/components/stats/stats-model";
import { useApi } from "@/hooks/use-api";
import {
  getHomeDateString,
  getHomeGreeting,
} from "@/components/home/HomeSections";
import {
  HomeShowPrepSection,
  HomeUpcomingSection,
} from "@/components/home/HomeUpcomingSections";
import { PullIndicator } from "@crate/ui/primitives/PullIndicator";

import type { HomePageController } from "@/pages/use-home-page-controller";
import type { HomePageViewModel } from "@/pages/home-page-model";
import { homePlaylistPath } from "@/pages/home-page-model";
import { STATS_DASHBOARD_LIMITS } from "@/pages/stats-page-model";

type LoadedHomePageController = Omit<HomePageController, "view"> & {
  view: HomePageViewModel;
};

interface HomeSectionProps {
  page: LoadedHomePageController;
}

function HomeHero({ page }: HomeSectionProps) {
  const { heroes, currentDiscovery } = page.view;
  const homeIntro = (
    <div>
      <h1 className="text-3xl font-bold text-text-primary">
        {getHomeGreeting(page.t)}
      </h1>
      <p className="mt-1 text-sm text-text-muted">
        {getHomeDateString(page.i18nLanguage)}
      </p>
    </div>
  );

  return (
    <HomeTasteHero
      heroes={heroes}
      heroSurfaces={currentDiscovery.hero_surfaces}
      isFollowing={page.isFollowing}
      onOpenArtist={page.openArtist}
      onPlay={(artist) => void page.playHeroArtist(artist)}
      onToggleFollow={(artist) => void page.toggleHeroFollow(artist)}
      desktopIntro={page.isDesktop ? homeIntro : undefined}
    />
  );
}

function HomeCommonRails({ page }: HomeSectionProps) {
  const {
    currentDiscovery,
    recentGlobalArtists,
    globalArtistsLoading,
    upcomingPreview,
    upcoming,
    homeInsights,
  } = page.view;

  return (
    <>
      <JustLandedSection
        artists={recentGlobalArtists}
        loading={globalArtistsLoading}
        onOpenExplore={() => page.navigate("/explore")}
      />
      <SuggestedAlbumsSection
        albums={currentDiscovery.suggested_albums || []}
        onViewAll={page.openHomeSection}
      />
      <UpcomingAlbumsSection
        albums={currentDiscovery.upcoming_albums || []}
        onViewAll={page.openHomeSection}
      />
      <HomeUpcomingSection
        previewItems={upcomingPreview}
        summary={upcoming?.summary}
        onOpenUpcoming={() => page.navigate("/upcoming")}
        onPlaySetlist={(item) => void page.playUpcomingSetlist(item)}
      />
      <HomeShowPrepSection
        insights={homeInsights}
        onOpenUpcoming={() => page.navigate("/upcoming")}
        onPlaySetlist={(insight) => void page.playInsightSetlist(insight)}
        onSaveReminder={(insight) => void page.acknowledgeInsight(insight)}
      />
    </>
  );
}

function HomeMobileRails({ page }: HomeSectionProps) {
  return <HomeCommonRails page={page} />;
}

const HOME_SIGNAL_DAYS = 30;

function homeListeningSignal(
  dashboard: StatsDashboard | null,
): HomeListeningSignal | null {
  if (!dashboard?.overview || dashboard.snapshot?.pending) return null;
  return {
    days: HOME_SIGNAL_DAYS,
    minutes: dashboard.overview.minutes_listened,
    plays: dashboard.overview.play_count,
    artists: dashboard.highlights?.artist_count ?? null,
    tape: dashboard.tape ?? null,
  };
}

function HomeDesktopRails({ page }: HomeSectionProps) {
  const { currentDiscovery, replay, replayPreview, recommendedTracks } =
    page.view;
  const { data: dashboard } = useApi<StatsDashboard>(
    `/api/me/stats/dashboard?window=${HOME_SIGNAL_DAYS}d&${STATS_DASHBOARD_LIMITS}`,
  );

  return (
    <>
      <RecommendedTracksSection
        tracks={recommendedTracks}
        onViewAll={page.openHomeSection}
      />
      <FavoriteArtistsSection
        artists={currentDiscovery.favorite_artists || []}
        onViewAll={page.openHomeSection}
      />
      <EssentialsSection
        items={currentDiscovery.essentials || []}
        onOpenPlaylist={(item) => page.navigate(homePlaylistPath(item.id))}
        onPlayPlaylist={(item) => void page.playHomePlaylist(item)}
        onShufflePlaylist={(item) => void page.shuffleHomePlaylist(item)}
        onStartRadio={(item) => void page.startHomePlaylistRadio(item)}
        onViewAll={page.openHomeSection}
      />
      <HomeCommonRails page={page} />
      <HomeReplaySection
        replay={replay || undefined}
        replayPreview={replayPreview}
        signal={homeListeningSignal(dashboard)}
        onOpenStats={page.openReplayStats}
        onPlayReplay={page.playReplayMix}
        onPlayTrack={page.playReplayTrack}
      />
    </>
  );
}

function HomeDiscoveryRails({ page }: HomeSectionProps) {
  const { currentDiscovery } = page.view;

  return (
    <div
      data-testid="home-discovery-content"
      className={`mx-auto w-full max-w-content space-y-10 px-6 pb-10 ${
        page.isDesktop ? "relative z-30 mt-0 pt-8 2xl:-mt-16 2xl:pt-0" : "pt-8"
      }`}
      style={{
        paddingLeft: page.isDesktop
          ? undefined
          : "max(1rem, var(--listen-safe-left))",
        paddingRight: page.isDesktop
          ? undefined
          : "max(1rem, var(--listen-safe-right))",
      }}
    >
      <RecentlyPlayedSection
        items={currentDiscovery.recently_played || []}
        onOpenItem={(item) => page.navigate(openRecentItemPath(item))}
        onViewAll={page.openHomeSection}
      />
      {page.isDesktop ? (
        <HomeDesktopRails page={page} />
      ) : (
        <HomeMobileRails page={page} />
      )}
    </div>
  );
}

export function HomeContent({ page }: HomeSectionProps) {
  return (
    <div className="w-full" {...page.pullHandlers}>
      <PullIndicator
        distance={page.pullDistance}
        refreshing={page.refreshing}
      />
      <HomeHero page={page} />
      <HomeDiscoveryRails page={page} />
    </div>
  );
}
