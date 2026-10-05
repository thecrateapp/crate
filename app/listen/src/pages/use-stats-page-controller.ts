import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useParams, useSearchParams } from "react-router";
import type { TFunction } from "i18next";

import {
  buildRecapHighlights,
  localizedReplayTitle,
  statsTrackRowData,
  toPlayerTrack,
  type ReplayMix,
  type StatsDashboard,
  type StatsStory,
  type StatsWindow,
} from "@/components/stats/stats-model";
import type { TrackRowData } from "@/components/cards/TrackRowModel";
import { usePlayerActions, type PlaySource } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { usePendingStatsSnapshotRefresh } from "@/hooks/use-pending-stats-snapshot-refresh";
import {
  buildSoundProfile,
  formatMonthTitle,
  normalizeMonthParam,
  normalizeWindowParam,
  STATS_WINDOWS,
  WINDOW_COPY_KEYS,
  type SoundProfile,
  type StatsPeriod,
} from "@/pages/stats-page-model";

const EMPTY_TOP_TRACKS: StatsDashboard["top_tracks"]["items"] = [];
const EMPTY_TOP_ARTISTS: StatsDashboard["top_artists"]["items"] = [];
const EMPTY_TOP_ALBUMS: StatsDashboard["top_albums"]["items"] = [];
const EMPTY_TOP_GENRES: StatsDashboard["top_genres"]["items"] = [];
const EMPTY_REPLAY_ITEMS: ReplayMix["items"] = [];

export interface StatsPageController {
  changeWindow: (window: StatsWindow) => void;
  coverTracks: StatsDashboard["top_tracks"]["items"];
  dashboard: StatsDashboard | null | undefined;
  dashboardLoading: boolean;
  hasStats: boolean;
  heroBody: string;
  heroTitle: string;
  isGlobalStats: boolean;
  isUserStats: boolean;
  leadArtist: StatsDashboard["top_artists"]["items"][number] | undefined;
  leadGenre: StatsDashboard["top_genres"]["items"][number] | undefined;
  leadTrack: StatsDashboard["top_tracks"]["items"][number] | undefined;
  overview: StatsDashboard["overview"] | undefined;
  period: StatsPeriod;
  playReplay: () => void;
  recapHighlights: ReturnType<typeof buildRecapHighlights>;
  replay: ReplayMix | undefined;
  replayItems: ReplayMix["items"];
  replayRows: TrackRowData[];
  replaySource: PlaySource;
  selectedMonth: string | null;
  selectedWindow: StatsWindow;
  soundProfile: SoundProfile;
  story: StatsStory | undefined;
  subjectName: string | null;
  t: ReturnType<typeof useTranslation>["t"];
  topAlbumItems: StatsDashboard["top_albums"]["items"];
  topArtistItems: StatsDashboard["top_artists"]["items"];
  topGenreItems: StatsDashboard["top_genres"]["items"];
  topTrackItems: StatsDashboard["top_tracks"]["items"];
  topTrackRows: TrackRowData[];
  topTrackSource: PlaySource;
  topComeback: StatsStory["comebacks"][number] | undefined;
  topDiscovery: StatsStory["discoveries"][number] | undefined;
  topMover: StatsStory["movers"][number] | undefined;
  trends: StatsDashboard["trends"] | undefined;
  username: string | undefined;
}

function resolveSelectedWindow(
  selectedMonth: string | null,
  searchWindow: string | null,
): StatsWindow {
  return selectedMonth ? "30d" : normalizeWindowParam(searchWindow);
}

function buildStatsPeriodQuery(
  selectedMonth: string | null,
  selectedWindow: StatsWindow,
): string {
  return selectedMonth ? `month=${selectedMonth}` : `window=${selectedWindow}`;
}

function buildStatsEndpoint(
  isGlobalStats: boolean,
  username: string | undefined,
): string {
  if (isGlobalStats) return "/api/stats/dashboard";
  if (username) {
    return `/api/users/${encodeURIComponent(username)}/stats/dashboard`;
  }
  return "/api/me/stats/dashboard";
}

function buildStatsPeriod(
  selectedMonth: string | null,
  selectedWindow: StatsWindow,
  locale: string,
  t: TFunction,
  windowCopy: Record<StatsWindow, StatsPeriod>,
): StatsPeriod {
  if (selectedMonth) {
    return {
      title: formatMonthTitle(selectedMonth, locale),
      label: t("stats.window.month"),
    };
  }
  return windowCopy[selectedWindow];
}

function buildStatsHeroCopy(
  isGlobalStats: boolean,
  isUserStats: boolean,
  subjectName: string | null,
  t: TFunction,
): Pick<StatsPageController, "heroBody" | "heroTitle"> {
  const heroTitle = isGlobalStats
    ? t("stats.hero.globalTitle")
    : isUserStats && subjectName
      ? t("stats.hero.userTitle", { name: subjectName })
      : t("stats.hero.yourTitle");
  const heroBody = isGlobalStats
    ? t("stats.hero.globalBody")
    : isUserStats
      ? t("stats.hero.userBody")
      : t("stats.hero.yourBody");
  return { heroBody, heroTitle };
}

export function useStatsPageController(): StatsPageController {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { username } = useParams<{ username: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const isGlobalStats = location.pathname === "/stats/global";
  const isUserStats = Boolean(username);
  const selectedMonth = normalizeMonthParam(searchParams.get("month"));
  const selectedWindow = resolveSelectedWindow(
    selectedMonth,
    searchParams.get("window"),
  );
  const statsPeriodQuery = buildStatsPeriodQuery(selectedMonth, selectedWindow);
  const windowCopy = useMemo(
    () =>
      Object.fromEntries(
        STATS_WINDOWS.map((window) => {
          const copy = WINDOW_COPY_KEYS[window];
          return [window, { title: t(copy.title), label: t(copy.label) }];
        }),
      ) as Record<StatsWindow, StatsPeriod>,
    [t],
  );
  const period = buildStatsPeriod(
    selectedMonth,
    selectedWindow,
    i18n.language,
    t,
    windowCopy,
  );
  const { playAll } = usePlayerActions();
  const statsEndpoint = buildStatsEndpoint(isGlobalStats, username);
  const {
    data: dashboard,
    loading: dashboardLoading,
    refetch: refetchDashboard,
  } = useApi<StatsDashboard>(
    `${statsEndpoint}?${statsPeriodQuery}&tracks_limit=12&artists_limit=10&albums_limit=12&genres_limit=10&replay_limit=36`,
  );
  usePendingStatsSnapshotRefresh(
    dashboard?.snapshot?.pending === true,
    refetchDashboard,
  );
  const overview = dashboard?.overview;
  const trends = dashboard?.trends;
  const topTrackItems = useMemo(
    () => dashboard?.top_tracks.items ?? EMPTY_TOP_TRACKS,
    [dashboard?.top_tracks.items],
  );
  const topArtistItems = useMemo(
    () => dashboard?.top_artists.items ?? EMPTY_TOP_ARTISTS,
    [dashboard?.top_artists.items],
  );
  const topAlbumItems = useMemo(
    () => dashboard?.top_albums.items ?? EMPTY_TOP_ALBUMS,
    [dashboard?.top_albums.items],
  );
  const topGenreItems = useMemo(
    () => dashboard?.top_genres.items ?? EMPTY_TOP_GENRES,
    [dashboard?.top_genres.items],
  );
  const replay = dashboard?.replay as ReplayMix | undefined;
  const story = dashboard?.story;
  const replayItems = replay?.items ?? EMPTY_REPLAY_ITEMS;
  const replayTitle =
    localizedReplayTitle(replay, t) || t("stats.replay.title");
  const topTrackRows = useMemo(
    () => topTrackItems.map(statsTrackRowData),
    [topTrackItems],
  );
  const replayRows = useMemo(
    () => replayItems.map(statsTrackRowData),
    [replayItems],
  );
  const topTrackSource = useMemo<PlaySource>(
    () => ({ type: "playlist", name: t("stats.topTracks.title") }),
    [t],
  );
  const replaySource = useMemo<PlaySource>(
    () => ({ type: "playlist", name: replayTitle }),
    [replayTitle],
  );
  const recapHighlights = useMemo(
    () =>
      buildRecapHighlights(
        overview ?? undefined,
        replay ?? undefined,
        topArtistItems,
        topTrackItems,
        t,
      ),
    [overview, replay, topArtistItems, topTrackItems, t],
  );
  const soundProfile = buildStatsSoundProfile(story, topTrackItems);
  const subjectName = resolveSubjectName(dashboard, username);
  const heroCopy = buildStatsHeroCopy(
    isGlobalStats,
    isUserStats,
    subjectName,
    t,
  );
  const leadTrack = topTrackItems[0];
  const leadArtist = topArtistItems[0];
  const leadGenre = topGenreItems[0];
  const topMover = story?.movers[0];
  const topDiscovery = story?.discoveries[0];
  const topComeback = story?.comebacks[0];

  function changeWindow(window: StatsWindow) {
    setSearchParams({ window });
  }

  function playReplay() {
    if (!replayItems.length) return;
    playAll(replayItems.map(toPlayerTrack), 0, replaySource);
  }

  return {
    changeWindow,
    coverTracks: replayItems.length ? replayItems : topTrackItems,
    dashboard,
    dashboardLoading,
    hasStats: Boolean(overview?.play_count),
    ...heroCopy,
    isGlobalStats,
    isUserStats,
    leadArtist,
    leadGenre,
    leadTrack,
    overview,
    period,
    playReplay,
    recapHighlights,
    replay,
    replayItems,
    replayRows,
    replaySource,
    selectedMonth,
    selectedWindow,
    soundProfile,
    story,
    subjectName,
    t,
    topAlbumItems,
    topArtistItems,
    topComeback,
    topDiscovery,
    topGenreItems,
    topMover,
    topTrackItems,
    topTrackRows,
    topTrackSource,
    trends,
    username,
  };
}

function resolveSubjectName(
  dashboard: StatsDashboard | null | undefined,
  username: string | undefined,
): string | null {
  return (
    dashboard?.subject?.display_name ||
    dashboard?.subject?.username ||
    username ||
    null
  );
}

function buildStatsSoundProfile(
  story: StatsStory | undefined,
  topTrackItems: StatsDashboard["top_tracks"]["items"],
): SoundProfile {
  if (story?.audio_profile) {
    return {
      energy: story.audio_profile.energy,
      danceability: story.audio_profile.danceability,
      valence: story.audio_profile.valence,
      bpm: story.audio_profile.bpm ?? null,
    };
  }
  return buildSoundProfile(topTrackItems);
}
