import { resolveMaybeApiAssetUrl } from "@/lib/api";
import type { GenreProfileItem } from "@crate/ui/domain/genres/GenrePill";

import type { UpcomingItem } from "./upcoming-types";
export type { UpcomingItem } from "./upcoming-types";

export interface ArtistShowEvent {
  id: string;
  show_id?: number;
  artist_name: string;
  artist_id?: number;
  artist_slug?: string;
  date: string;
  local_time?: string;
  venue: string;
  address_line1?: string;
  city: string;
  region?: string;
  postal_code?: string;
  country: string;
  country_code: string;
  url?: string;
  image_url?: string;
  lineup?: string[];
  artist_genres?: string[];
  artist_genre_profile?: GenreProfileItem[];
  latitude?: number;
  longitude?: number;
  probable_setlist?: { title: string; position?: number; frequency?: number }[];
  user_attending?: boolean;
}

export function artistShowToUpcomingItem(show: ArtistShowEvent): UpcomingItem {
  return {
    id: show.show_id,
    event_key: show.id,
    type: "show",
    date: show.date,
    time: show.local_time,
    artist: show.artist_name,
    artist_id: show.artist_id,
    artist_slug: show.artist_slug,
    title: show.venue || "",
    subtitle: [show.city, show.country].filter(Boolean).join(", "),
    cover_url: resolveMaybeApiAssetUrl(show.image_url) || null,
    status: "onsale",
    url: show.url,
    venue: show.venue,
    address_line1: show.address_line1,
    city: show.city,
    region: show.region,
    postal_code: show.postal_code,
    country: show.country,
    country_code: show.country_code,
    latitude: show.latitude,
    longitude: show.longitude,
    lineup: show.lineup,
    genres: show.artist_genres || [],
    genre_profile: show.artist_genre_profile,
    probable_setlist: show.probable_setlist || [],
    user_attending: show.user_attending,
    is_upcoming: true,
  };
}

export function canOpenUpcomingRelease(item: UpcomingItem) {
  if (item.type !== "release") return false;
  if (item.album_id != null) return true;
  return Boolean(item.is_upcoming && item.release_id != null);
}

export function upcomingReleaseBadgeLabel(item: UpcomingItem) {
  if (item.type !== "release") return "";
  return item.is_upcoming ? "Pre-release" : "Released";
}

export { upcomingCountdown } from "./upcoming-timing-model";

export { itemKey, groupByMonth, formatMonthLabel } from "./upcoming-list-model";
