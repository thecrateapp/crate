export type InsightsWindow = "30d" | "90d" | "365d";
export interface InsightAlbum {
  id: number;
  entity_uid: string | null;
  slug: string | null;
  title: string;
  artist: string;
  artist_slug: string | null;
  year: string | null;
  has_cover: boolean;
  tracks: number;
  played_tracks: number;
  minutes: number;
  last_day: string | null;
}
export interface InsightComparison {
  key: string;
  label: string;
  genre_slug: string | null;
  tracks: number;
  albums: number;
  played_tracks: number;
  plays: number;
  minutes: number;
  catalogue_share: number;
  listening_share: number;
  previous_listening_share: number;
  examples: InsightAlbum[];
}
export interface InsightArtistChange {
  id: number;
  entity_uid: string | null;
  slug: string | null;
  name: string;
  has_photo: boolean;
  current_minutes: number;
  previous_minutes: number;
  delta_minutes: number;
}
interface ListeningReading {
  plays: number;
  minutes: number;
  tracks: number;
  albums: number;
  concentration_pct: number | null;
}
export interface CollectionInsights {
  ready: boolean;
  window: InsightsWindow;
  period: {
    start: string;
    end: string;
    previous_start: string;
    previous_end: string;
    history_start: string | null;
    calendar: "listener_local_days";
    previous_complete: boolean;
    history_complete: boolean;
  } | null;
  catalogue: { tracks: number; albums: number } | null;
  current: ListeningReading | null;
  previous: ListeningReading | null;
  excluded: { plays: number; minutes: number } | null;
  timeline: { day: string; minutes: number; previous_minutes: number }[];
  genres: InsightComparison[];
  decades: InsightComparison[];
  rising: InsightArtistChange[];
  falling: InsightArtistChange[];
  unheard: { total: number; items: InsightAlbum[] };
  rediscover: { total: number; items: InsightAlbum[] };
  improvements: {
    key: "full" | "bliss";
    tracks: number;
    minutes: number;
    albums: InsightAlbum[];
  }[];
  snapshot?: {
    built_at?: string | null;
    stale?: boolean;
    missing?: boolean;
    pending?: boolean;
    task_id?: string | null;
    refresh_error?: boolean;
  };
}
export const number = (value: number) =>
  new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
export const percent = (value: number | null) =>
  value === null ? "Unavailable" : `${number(value)}%`;
export const minutes = (value: number) => `${number(value)} min`;
export function change(current: number, previous: number) {
  const delta = current - previous;
  const absolute = `${delta > 0 ? "+" : ""}${number(delta)}`;
  return previous === 0
    ? current === 0
      ? "No activity in either period"
      : "No activity in previous period"
    : `${absolute} (${delta > 0 ? "+" : ""}${number((delta / previous) * 100)}%) vs previous`;
}
