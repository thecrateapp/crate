export type StatsWindow = "7d" | "30d" | "90d" | "365d" | "all_time";
export type StatsYearWindow = `year:${number}`;
export type StatsSelection = StatsWindow | StatsYearWindow;
export type StatsPeriodKey = StatsSelection | `month:${string}`;

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
  slug?: string | null;
  play_count: number;
  complete_play_count: number;
  minutes_listened: number;
  weight?: number | null;
  share?: number | null;
}

export interface StatsListResponse<T> {
  window: StatsPeriodKey;
  items: T[];
}

export interface ReplayMix {
  window: StatsPeriodKey;
  title: string;
  subtitle: string;
  title_key?: string | null;
  subtitle_key?: string | null;
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

export interface StatsSnapshot {
  scope?: string | null;
  subject_key?: string | null;
  version?: number;
  built_at?: string | null;
  stale_after?: string | null;
  stale?: boolean;
  pending?: boolean;
  generation_ms?: number;
}

export interface StatsTrackRef {
  track_id?: number | null;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  album_id?: number | null;
  album_slug?: string | null;
  global_album_uid?: string | null;
  artist_id?: number | null;
  artist_slug?: string | null;
}

export interface StatsAlbumRef {
  album?: string | null;
  artist?: string | null;
  plays?: number | null;
  album_id?: number | null;
  album_slug?: string | null;
  global_album_uid?: string | null;
}

export interface StatsTapePoint {
  bucket: string;
  minutes: number;
  plays: number;
}

export interface StatsTapeMood {
  bucket: string;
  energy?: number | null;
  valence?: number | null;
}

export interface StatsTapePeak {
  kind: "obsession" | "longest_day" | "discovery" | string;
  bucket: string;
  day: string;
  value: number;
  track?: StatsTrackRef | null;
  artist?: string | null;
}

export interface StatsTapeMonth {
  month: string;
  minutes: number;
  plays: number;
  top_artist?: string | null;
  top_album?: StatsAlbumRef | null;
}

export interface StatsTape {
  granularity: "day" | "week";
  start: string;
  end: string;
  points: StatsTapePoint[];
  mood: StatsTapeMood[];
  peaks: StatsTapePeak[];
  months: StatsTapeMonth[];
}

export interface StatsStreak {
  days: number;
  start?: string | null;
  end?: string | null;
}

export interface StatsHighlights {
  artist_count?: number | null;
  longest_streak?: StatsStreak | null;
  current_streak?: StatsStreak | null;
  new_artists?: { count: number; share: number } | null;
  longest_session?: {
    minutes: number;
    started_at?: string | null;
    ended_at?: string | null;
    track_count: number;
  } | null;
  obsession?: {
    day: string;
    plays: number;
    minutes: number;
    track: StatsTrackRef;
  } | null;
}

export interface StatsArtistOfPeriod {
  artist_name: string;
  listener_count?: number | null;
  listener_top_percent?: number | null;
  artist_id?: number | null;
  artist_slug?: string | null;
  global_artist_uid?: string | null;
  plays: number;
  minutes: number;
  active_days: number;
  first_day_in_period?: string | null;
  first_ever_day?: string | null;
  top_album?: StatsAlbumRef | null;
}

export interface StatsHeatmap {
  cells: number[][];
  peak?: { weekday: number; hour: number } | null;
  night_share: number;
}

export interface StatsDecadeAlbum {
  album: string;
  artist?: string | null;
  album_id?: number | null;
  album_slug?: string | null;
  year: number;
}

export interface StatsTopListener {
  user_id: number;
  username?: string | null;
  display_name?: string | null;
  avatar?: string | null;
  minutes: number;
  plays: number;
  active_days: number;
}

export interface StatsMusicAge {
  median_year: number;
  decades: {
    decade: number;
    share: number;
    top_album?: StatsDecadeAlbum | null;
  }[];
  oldest_album?: {
    album: string;
    artist?: string | null;
    album_id?: number | null;
    album_slug?: string | null;
    year: number;
  } | null;
}

export interface StatsGenreTrend {
  genre_name: string;
  slug?: string | null;
  share: number;
  delta_vs_previous?: number | null;
}

export interface StatsToday {
  day: string;
  timezone: string;
  minutes: number;
  plays: number;
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
  snapshot?: StatsSnapshot;
  timezone?: string | null;
  provisional?: boolean | null;
  computed_until?: string | null;
  metrics_version?: string | null;
  tape?: StatsTape | null;
  highlights?: StatsHighlights | null;
  artist_of_period?: StatsArtistOfPeriod | null;
  heatmap?: StatsHeatmap | null;
  music_age?: StatsMusicAge | null;
  top_listeners?: StatsTopListener[];
  genre_trend?: StatsGenreTrend[];
}
