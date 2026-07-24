import type { Track } from "@/contexts/PlayerContext";
import { toPlayableTrack } from "@/lib/playable-track";

export type StatsWindow = "7d" | "30d" | "90d" | "365d" | "all_time";
export type StatsPeriodKey = StatsWindow | `month:${string}`;

export interface StatsOverview {
  window: StatsPeriodKey;
  play_count: number;
  complete_play_count: number;
  skip_count: number;
  minutes_listened: number;
  active_days: number;
  skip_rate: number;
  top_artist: {
    artist_name: string;
    global_artist_uid?: string | null;
    artist_id?: number | null;
    artist_slug?: string | null;
    play_count: number;
    minutes_listened: number;
  } | null;
}

export interface StatsTrendPoint {
  day: string;
  play_count: number;
  complete_play_count: number;
  skip_count: number;
  minutes_listened: number;
}

export interface StatsTrends {
  window: StatsPeriodKey;
  points: StatsTrendPoint[];
}

export interface StatsTrack {
  track_id: number | null;
  global_track_uid?: string | null;
  global_artist_uid?: string | null;
  global_album_uid?: string | null;
  track_entity_uid?: string | null;
  track_path: string | null;
  title: string;
  artist: string;
  artist_id?: number | null;
  artist_slug?: string | null;
  album: string;
  album_id?: number | null;
  album_slug?: string | null;
  bpm?: number | null;
  audio_key?: string | null;
  audio_scale?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  bliss_vector?: number[] | null;
  play_count: number;
  complete_play_count: number;
  minutes_listened: number;
}

export interface StatsArtist {
  artist_name: string;
  global_artist_uid?: string | null;
  artist_id?: number | null;
  artist_slug?: string | null;
  play_count: number;
  complete_play_count: number;
  minutes_listened: number;
}

export interface StatsAlbum {
  artist: string;
  global_artist_uid?: string | null;
  artist_id?: number | null;
  artist_slug?: string | null;
  album: string;
  global_album_uid?: string | null;
  album_id?: number | null;
  album_slug?: string | null;
  play_count: number;
  complete_play_count: number;
  minutes_listened: number;
}

export interface StatsGenre {
  genre_name: string;
  play_count: number;
  complete_play_count: number;
  minutes_listened: number;
}

export interface StatsListResponse<T> {
  window: StatsPeriodKey;
  items: T[];
}

export interface ReplayMix {
  window: StatsPeriodKey;
  title: string;
  subtitle: string;
  track_count: number;
  minutes_listened: number;
  items: StatsTrack[];
}

export interface StatsStoryArtistSignal {
  artist_name: string;
  artist_id?: number | null;
  artist_slug?: string | null;
  play_count: number;
  minutes_listened: number;
  previous_play_count?: number | null;
  delta_play_count?: number | null;
  first_played_at?: string | null;
  last_seen_at?: string | null;
}

export interface StatsRhythm {
  peak_hour?: number | null;
  peak_hour_label?: string | null;
  peak_weekday?: string | null;
  peak_hour_play_count: number;
  peak_weekday_play_count: number;
}

export interface StatsAudioProfile {
  energy: number;
  danceability: number;
  valence: number;
  bpm?: number | null;
}

export interface StatsMonthlySnapshotArtist {
  artist_name: string;
  play_count: number;
  minutes_listened: number;
}

export interface StatsMonthlySnapshotCover {
  track_id?: number | null;
  global_track_uid?: string | null;
  global_album_uid?: string | null;
  track_entity_uid?: string | null;
  track_path?: string | null;
  title: string;
  artist: string;
  artist_id?: number | null;
  artist_slug?: string | null;
  album: string;
  album_id?: number | null;
  album_slug?: string | null;
}

export interface StatsMonthlySnapshot {
  period_kind?: "all_time" | "month";
  month_key: string;
  month_start: string;
  title: string;
  subtitle: string;
  play_count: number;
  minutes_listened: number;
  active_days: number;
  top_artists: StatsMonthlySnapshotArtist[];
  covers: StatsMonthlySnapshotCover[];
}

export interface StatsStory {
  window: StatsPeriodKey;
  movers: StatsStoryArtistSignal[];
  discoveries: StatsStoryArtistSignal[];
  comebacks: StatsStoryArtistSignal[];
  rhythm: StatsRhythm;
  audio_profile: StatsAudioProfile;
  monthly_snapshots: StatsMonthlySnapshot[];
}

export interface StatsSubject {
  kind: "user" | "instance" | string;
  user_id?: number | null;
  username?: string | null;
  display_name?: string | null;
  avatar?: string | null;
}

export interface StatsAffinity {
  affinity_score: number;
  affinity_band: "low" | "medium" | "high" | "very_high" | string;
  affinity_reasons: string[];
}

export interface StatsDashboard {
  window: StatsPeriodKey;
  subject?: StatsSubject | null;
  overview: StatsOverview;
  trends: StatsTrends;
  top_tracks: StatsListResponse<StatsTrack>;
  top_artists: StatsListResponse<StatsArtist>;
  top_albums: StatsListResponse<StatsAlbum>;
  top_genres: StatsListResponse<StatsGenre>;
  replay: ReplayMix;
  story?: StatsStory;
  viewer_affinity?: StatsAffinity | null;
}

export interface RecapHighlight {
  title: string;
  body: string;
}

type RecapTranslate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export const STATS_WINDOW_OPTIONS: { value: StatsWindow; label: string }[] = [
  { value: "7d", label: "stats.window.short.7d" },
  { value: "30d", label: "stats.window.short.30d" },
  { value: "90d", label: "stats.window.short.90d" },
  { value: "365d", label: "stats.window.short.365d" },
  { value: "all_time", label: "stats.window.short.allTime" },
];

export function formatStatsMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0m";
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remaining = Math.round(minutes % 60);
    return remaining > 0 ? `${hours}h ${remaining}m` : `${hours}h`;
  }
  return `${Math.round(minutes)}m`;
}

export function formatStatsPercent(value: number): string {
  return `${Math.round((value || 0) * 100)}%`;
}

export function toPlayerTrack(item: StatsTrack): Track {
  return toPlayableTrack({
    ...item,
    id: item.track_id || `${item.artist}-${item.title}`,
  });
}

export function buildRecapHighlights(
  overview: StatsOverview | undefined,
  replay: ReplayMix | undefined,
  topArtists: StatsArtist[],
  topTracks: StatsTrack[],
  t: RecapTranslate,
): RecapHighlight[] {
  const highlights: RecapHighlight[] = [];

  if (overview?.top_artist?.artist_name) {
    highlights.push({
      title: t("stats.recap.topArtistTitle", {
        artist: overview.top_artist.artist_name,
      }),
      body: t("stats.recap.topArtistBody", {
        count: overview.top_artist.play_count,
        minutes: formatStatsMinutes(overview.top_artist.minutes_listened),
      }),
    });
  }

  if (topTracks[0] && topTracks[0].play_count > 0) {
    highlights.push({
      title: t("stats.recap.topTrackTitle", { track: topTracks[0].title }),
      body: t("stats.recap.topTrackBody", {
        artist: topTracks[0].artist,
        count: topTracks[0].play_count,
      }),
    });
  }

  if (overview && overview.play_count > 0) {
    const cadence =
      overview.active_days >= 20
        ? t("stats.recap.cadenceDaily")
        : overview.active_days >= 10
          ? t("stats.recap.cadenceSteady")
          : t("stats.recap.cadenceTakingShape");
    highlights.push({
      title: t("stats.recap.minutesTitle", {
        minutes: formatStatsMinutes(overview.minutes_listened),
      }),
      body: t("stats.recap.minutesBody", {
        cadence,
        count: overview.complete_play_count,
      }),
    });
  }

  if (replay?.track_count && replay.track_count > 0) {
    highlights.push({
      title: t("stats.recap.replayTitle", { count: replay.track_count }),
      body: topArtists.length
        ? t("stats.recap.replayArtistsBody", {
            count: Math.min(topArtists.length, 8),
          })
        : t("stats.recap.replayReadyBody"),
    });
  }

  return highlights.slice(0, 3);
}
