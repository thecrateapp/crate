import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useParams, useSearchParams } from "react-router";
import type { TFunction } from "i18next";

import {
  localizedReplayTitle,
  statsTrackRowData,
  toPlayerTrack,
  type ReplayMix,
  type StatsDashboard,
  type StatsSelection,
  type StatsStory,
  type StatsToday,
} from "@/components/stats/stats-model";
import type { TrackRowData } from "@/components/cards/TrackRowModel";
import { usePlayerActions, type PlaySource } from "@/contexts/PlayerContext";
import { useApi } from "@/hooks/use-api";
import { usePendingStatsSnapshotRefresh } from "@/hooks/use-pending-stats-snapshot-refresh";
import {
  buildSoundProfile,
  formatMonthTitle,
  normalizeMonthParam,
  normalizeSelectionParam,
  selectionDays,
  selectionYear,
  statsSelectionOptions,
  type SoundProfile,
  type StatsSelectionOption,
} from "@/pages/stats-page-model";

const EMPTY_TOP_TRACKS: StatsDashboard["top_tracks"]["items"] = [];
const EMPTY_TOP_ARTISTS: StatsDashboard["top_artists"]["items"] = [];
const EMPTY_TOP_ALBUMS: StatsDashboard["top_albums"]["items"] = [];
const EMPTY_TOP_GENRES: StatsDashboard["top_genres"]["items"] = [];
const EMPTY_REPLAY_ITEMS: ReplayMix["items"] = [];
const EMPTY_DISCOVERIES: StatsStory["discoveries"] = [];

export interface StatsPageController {
  changeSelection: (selection: StatsSelection) => void;
  dashboard: StatsDashboard | null | undefined;
  dashboardLoading: boolean;
  discoveries: StatsStory["discoveries"];
  hasStats: boolean;
  isGlobalStats: boolean;
  isUserStats: boolean;
  kicker: string;
  overview: StatsDashboard["overview"] | undefined;
  playReplay: () => void;
  replayItems: ReplayMix["items"];
  selectedMonth: string | null;
  selection: StatsSelection;
  selectionOptions: StatsSelectionOption[];
  signalTitle: { lead: string; accent: string };
  soundProfile: SoundProfile;
  subjectName: string | null;
  t: ReturnType<typeof useTranslation>["t"];
  today: StatsToday | null;
  topAlbumItems: StatsDashboard["top_albums"]["items"];
  topArtistItems: StatsDashboard["top_artists"]["items"];
  topGenreItems: StatsDashboard["top_genres"]["items"];
  topTrackItems: StatsDashboard["top_tracks"]["items"];
  topTrackRows: TrackRowData[];
  topTrackSource: PlaySource;
  username: string | undefined;
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

function buildKicker(
  isGlobalStats: boolean,
  isUserStats: boolean,
  subjectName: string | null,
  t: TFunction,
): string {
  if (isGlobalStats) return t("stats.hero.globalTitle");
  if (isUserStats && subjectName) {
    return t("stats.hero.userTitle", { name: subjectName });
  }
  return t("stats.hero.yourTitle");
}

function buildSignalTitle(
  selectedMonth: string | null,
  selection: StatsSelection,
  locale: string,
  t: TFunction,
): { lead: string; accent: string } {
  const accent = t("stats.signal.title.accent");
  if (selectedMonth) {
    return {
      lead: t("stats.signal.title.month", {
        month: formatMonthTitle(selectedMonth, locale),
      }),
      accent,
    };
  }
  const year = selectionYear(selection);
  if (year !== null)
    return { lead: t("stats.signal.title.year", { year }), accent };
  const days = selectionDays(selection);
  if (days !== null) {
    return { lead: t("stats.signal.title.days", { count: days }), accent };
  }
  return { lead: t("stats.signal.title.allTime"), accent };
}

export function useStatsPageController(): StatsPageController {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { username } = useParams<{ username: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const isGlobalStats = location.pathname === "/stats/global";
  const isUserStats = Boolean(username);
  const currentYear = new Date().getFullYear();
  const selectedMonth = normalizeMonthParam(searchParams.get("month"));
  const requested = normalizeSelectionParam(
    searchParams.get("window"),
    currentYear,
  );
  const selection: StatsSelection =
    isGlobalStats && selectionYear(requested) !== null ? "365d" : requested;
  const selectionOptions = useMemo(
    () => statsSelectionOptions(currentYear, { calendarYear: !isGlobalStats }),
    [currentYear, isGlobalStats],
  );
  const periodQuery = selectedMonth
    ? `month=${selectedMonth}`
    : `window=${encodeURIComponent(selection)}`;
  const { playAll } = usePlayerActions();
  const statsEndpoint = buildStatsEndpoint(isGlobalStats, username);
  const {
    data: dashboard,
    loading: dashboardLoading,
    refetch: refetchDashboard,
  } = useApi<StatsDashboard>(
    `${statsEndpoint}?${periodQuery}&tracks_limit=12&artists_limit=10&albums_limit=12&genres_limit=10&replay_limit=36`,
  );
  const { data: today } = useApi<StatsToday>(
    !isGlobalStats && !isUserStats ? "/api/me/stats/today" : null,
  );
  usePendingStatsSnapshotRefresh(
    dashboard?.snapshot?.pending === true,
    refetchDashboard,
  );
  const overview = dashboard?.overview;
  const topTrackItems = dashboard?.top_tracks.items ?? EMPTY_TOP_TRACKS;
  const topArtistItems = dashboard?.top_artists.items ?? EMPTY_TOP_ARTISTS;
  const topAlbumItems = dashboard?.top_albums.items ?? EMPTY_TOP_ALBUMS;
  const topGenreItems = dashboard?.top_genres.items ?? EMPTY_TOP_GENRES;
  const replay = dashboard?.replay as ReplayMix | undefined;
  const story = dashboard?.story;
  const replayItems = replay?.items ?? EMPTY_REPLAY_ITEMS;
  const replayTitle =
    localizedReplayTitle(replay, t) || t("stats.replay.title");
  const topTrackRows = useMemo(
    () => topTrackItems.map(statsTrackRowData),
    [topTrackItems],
  );
  const topTrackSource = useMemo<PlaySource>(
    () => ({ type: "playlist", name: t("stats.topTracks.title") }),
    [t],
  );
  const subjectName = resolveSubjectName(dashboard, username);

  function changeSelection(next: StatsSelection) {
    setSearchParams({ window: next });
  }

  function playReplay() {
    if (!replayItems.length) return;
    playAll(replayItems.map(toPlayerTrack), 0, {
      type: "playlist",
      name: replayTitle,
    });
  }

  return {
    changeSelection,
    dashboard,
    dashboardLoading,
    discoveries: story?.discoveries ?? EMPTY_DISCOVERIES,
    hasStats: Boolean(overview?.play_count),
    isGlobalStats,
    isUserStats,
    kicker: buildKicker(isGlobalStats, isUserStats, subjectName, t),
    overview,
    playReplay,
    replayItems,
    selectedMonth,
    selection,
    selectionOptions,
    signalTitle: buildSignalTitle(selectedMonth, selection, i18n.language, t),
    soundProfile: buildStatsSoundProfile(story, topTrackItems),
    subjectName,
    t,
    today: today ?? null,
    topAlbumItems,
    topArtistItems,
    topGenreItems,
    topTrackItems,
    topTrackRows,
    topTrackSource,
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
