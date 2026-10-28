import type { GenreProfileItem } from "@crate/ui/domain/genres/GenrePill";

export interface UpcomingItem {
  id?: number;
  event_key?: string;
  type: "release" | "show";
  date: string;
  time?: string;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
  album_id?: number;
  album_slug?: string;
  title: string;
  subtitle: string;
  cover_url: string | null;
  status: string;
  is_upcoming: boolean;
  tidal_url?: string;
  release_id?: number;
  url?: string;
  venue?: string;
  address_line1?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
  lineup?: string[];
  genres?: string[];
  genre_profile?: GenreProfileItem[];
  probable_setlist?: { title: string; position?: number; frequency?: number }[];
  user_attending?: boolean;
}
