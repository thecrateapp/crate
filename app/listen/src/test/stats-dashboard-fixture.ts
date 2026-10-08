import type { StatsDashboard } from "@/components/stats/stats-model";

export function baseDashboard(window = "30d"): StatsDashboard {
  return {
    window: window as StatsDashboard["window"],
    overview: {
      window: window as StatsDashboard["window"],
      play_count: 0,
      complete_play_count: 0,
      skip_count: 0,
      minutes_listened: 0,
      active_days: 0,
      skip_rate: 0,
      top_artist: null,
    },
    trends: { window: "30d", points: [] },
    top_tracks: { window: "30d", items: [] },
    top_artists: { window: "30d", items: [] },
    top_albums: { window: "30d", items: [] },
    top_genres: { window: "30d", items: [] },
    replay: {
      window: "30d",
      title: "Replay",
      subtitle: "Snapshot",
      track_count: 0,
      minutes_listened: 0,
      items: [],
    },
  };
}

export function signalDashboard(): StatsDashboard {
  const dashboard = baseDashboard();
  dashboard.overview = {
    ...dashboard.overview,
    play_count: 812,
    minutes_listened: 3420,
    active_days: 27,
  };
  return {
    ...dashboard,
    timezone: "Europe/Madrid",
    provisional: true,
    metrics_version: "listening-v1",
    tape: {
      granularity: "day",
      start: "2026-09-09",
      end: "2026-10-09",
      points: Array.from({ length: 30 }, (_, index) => ({
        bucket: `2026-09-${String(9 + Math.min(index, 21)).padStart(2, "0")}`,
        minutes: 20 + index,
        plays: 5,
      })),
      mood: [
        { bucket: "2026-09-09", energy: 0.6, valence: 0.4 },
        { bucket: "2026-09-20", energy: 0.8, valence: 0.5 },
      ],
      peaks: [
        {
          kind: "obsession",
          bucket: "2026-09-14",
          day: "2026-09-14",
          value: 31,
          track: { title: "Spectral Wound", artist: "Black Curse" },
        },
      ],
      months: [
        { month: "2026-09", minutes: 900, plays: 210, top_artist: "Converge" },
      ],
    },
    highlights: {
      artist_count: 64,
      longest_streak: { days: 47, start: "2026-08-02", end: "2026-09-17" },
      current_streak: { days: 12 },
      new_artists: { count: 9, share: 0.21 },
      longest_session: {
        minutes: 400,
        started_at: "2026-09-05T18:00:00+00:00",
        track_count: 92,
      },
      obsession: {
        day: "2026-09-14",
        plays: 31,
        minutes: 120,
        track: {
          title: "Spectral Wound",
          artist: "Black Curse",
          album: "Burning",
        },
      },
    },
    artist_of_period: {
      artist_name: "Converge",
      listener_top_percent: 3,
      artist_id: 8,
      artist_slug: "converge",
      plays: 204,
      minutes: 720,
      active_days: 18,
      first_day_in_period: "2026-09-10",
      top_album: { album: "Jane Doe", plays: 80 },
    },
    heatmap: {
      cells: Array.from({ length: 7 }, (_, weekday) =>
        Array.from({ length: 24 }, (_, hour) =>
          weekday === 6 && hour === 22 ? 90 : 5,
        ),
      ),
      peak: { weekday: 6, hour: 22 },
      night_share: 0.38,
    },
    music_age: {
      median_year: 2009,
      decades: [
        { decade: 1990, share: 0.2 },
        { decade: 2000, share: 0.5 },
        { decade: 2010, share: 0.3 },
      ],
      oldest_album: { album: "When Forever Comes Crashing", year: 1998 },
    },
    genre_trend: [
      {
        genre_name: "Metalcore",
        slug: "metalcore",
        share: 0.34,
        delta_vs_previous: 0.09,
      },
    ],
    story: {
      window: "30d",
      movers: [],
      discoveries: [
        {
          artist_name: "Angine de Poitrine",
          play_count: 42,
          minutes_listened: 90,
          first_played_at: "2026-09-26T21:00:00+00:00",
        },
      ],
      comebacks: [],
      rhythm: { peak_hour_play_count: 0, peak_weekday_play_count: 0 },
      audio_profile: {
        energy: 0.79,
        danceability: 0.32,
        valence: 0.5,
        bpm: 137,
      },
      monthly_snapshots: [],
    },
  };
}
