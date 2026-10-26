import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  Calendar,
  CRATE_ICON_SIZE,
  ExternalLink,
  UserRound,
} from "@crate/ui/icons";
import { X } from "lucide-react";
import { GenrePillRow } from "@crate/ui/domain/genres/GenrePill";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { UpcomingDateStamp } from "@crate/ui/domain/shows/UpcomingDateStamp";
import { UpcomingEventRow } from "@crate/ui/domain/shows/UpcomingEventRow";
import {
  ActionButton,
  ActionGroup,
  ActionLink,
} from "@crate/ui/primitives/ActionGroup";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { TooltipHint } from "@crate/ui/shadcn/tooltip";
import { artistPagePath, artistPhotoApiUrl } from "@/lib/library-routes";
import { timeAgo } from "@/lib/utils";
import "@/pages/upcoming-show-ticket.css";

export interface UpcomingItem {
  type: "show";
  /** The canonical show ID, on show items only. */
  show_id?: number;
  date: string;
  time?: string;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
  title: string;
  subtitle: string;
  cover_url: string | null;
  status: string;
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
  lineup_artists?: UpcomingArtistRef[];
  genres?: string[];
  probable_setlist_status?:
    "fresh" | "stale" | "missing" | "unknown" | "refreshing";
  probable_setlist_generated_at?: string | null;
  probable_setlist_song_count?: number;
  probable_setlist_source_show_count?: number | null;
  probable_setlist_mode?: string | null;
  probable_setlist_tour_name?: string | null;
}

export interface CachedShowEvent {
  id: string;
  show_id?: number | null;
  artist_name: string;
  artist_id?: number | null;
  artist_slug?: string | null;
  date: string;
  local_time?: string | null;
  venue?: string | null;
  address_line1?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
  country?: string | null;
  country_code?: string | null;
  url?: string | null;
  image_url?: string | null;
  lineup?: string[] | null;
  lineup_artists?: UpcomingArtistRef[];
  artist_genres?: string[];
  probable_setlist_status?: UpcomingItem["probable_setlist_status"];
  probable_setlist_generated_at?: string | null;
  probable_setlist_song_count?: number;
  probable_setlist_source_show_count?: number | null;
  probable_setlist_mode?: string | null;
  probable_setlist_tour_name?: string | null;
}

export interface UpcomingArtistRef {
  name: string;
  id?: number;
  slug?: string;
  probable_setlist_status?: UpcomingItem["probable_setlist_status"];
  probable_setlist_generated_at?: string | null;
  probable_setlist_song_count?: number;
  probable_setlist_source_show_count?: number | null;
  probable_setlist_mode?: string | null;
  probable_setlist_tour_name?: string | null;
}

export function upcomingItemFromCachedShow(
  show: CachedShowEvent,
): UpcomingItem {
  return {
    type: "show",
    show_id: show.show_id ?? Number(show.id),
    date: show.date?.slice(0, 10) || "",
    time: show.local_time || "",
    artist: show.artist_name,
    artist_id: show.artist_id ?? undefined,
    artist_slug: show.artist_slug ?? undefined,
    title: show.venue || show.artist_name,
    subtitle: [show.venue, show.city, show.country].filter(Boolean).join(" · "),
    cover_url: show.image_url || null,
    status: "onsale",
    url: show.url || undefined,
    venue: show.venue || "",
    address_line1: show.address_line1 || undefined,
    city: show.city || "",
    region: show.region || undefined,
    postal_code: show.postal_code || undefined,
    country: show.country || "",
    country_code: show.country_code || undefined,
    latitude: undefined,
    longitude: undefined,
    lineup: show.lineup || [],
    genres: show.artist_genres || [],
    probable_setlist_status: show.probable_setlist_status || "unknown",
    probable_setlist_generated_at: show.probable_setlist_generated_at || null,
    probable_setlist_song_count: show.probable_setlist_song_count || 0,
    probable_setlist_source_show_count:
      show.probable_setlist_source_show_count ?? null,
    probable_setlist_mode: show.probable_setlist_mode ?? null,
    probable_setlist_tour_name: show.probable_setlist_tour_name ?? null,
    lineup_artists: (show.lineup_artists || []).map((artist) => ({
      ...artist,
      probable_setlist_mode: artist.probable_setlist_mode ?? null,
      probable_setlist_tour_name: artist.probable_setlist_tour_name ?? null,
    })),
  };
}

function getArtistHref(artist: UpcomingArtistRef | null | undefined) {
  if (!artist || artist.id == null) return undefined;
  return artistPagePath({
    artistId: artist.id,
    artistSlug: artist.slug,
    artistName: artist.name,
  });
}

function setlistTone(
  status: UpcomingArtistRef["probable_setlist_status"],
): "success" | "warning" | "info" | "neutral" {
  if (status === "fresh") return "success";
  if (status === "stale" || status === "refreshing") return "warning";
  if (status === "unknown") return "info";
  return "neutral";
}

function setlistLabel(artist: UpcomingArtistRef) {
  const status = artist.probable_setlist_status || "unknown";
  if (status === "fresh") return "Current";
  if (status === "stale") return "Outdated";
  if (status === "refreshing") return "Refreshing";
  if (status === "missing") return "No setlist";
  return "Date unknown";
}

function showCountdown(item: UpcomingItem): string | null {
  if (!item.date) return null;
  const target = new Date(`${item.date}T${item.time || "23:59:59"}`);
  if (
    Number.isNaN(target.getTime()) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(item.date) ||
    target.getMonth() + 1 !== Number(item.date.slice(5, 7)) ||
    target.getDate() !== Number(item.date.slice(8, 10))
  )
    return null;
  const millisecondsRemaining = target.getTime() - Date.now();
  if (millisecondsRemaining <= 0) return null;
  const hours = Math.max(1, Math.ceil(millisecondsRemaining / 3_600_000));
  return hours < 48
    ? `${hours} ${hours === 1 ? "hour" : "hours"} to go`
    : `${Math.ceil(hours / 24)} days to go`;
}

function showDateLabel(item: UpcomingItem): string {
  const date = new Date(`${item.date}T12:00:00`);
  if (
    Number.isNaN(date.getTime()) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(item.date) ||
    date.getMonth() + 1 !== Number(item.date.slice(5, 7)) ||
    date.getDate() !== Number(item.date.slice(8, 10))
  )
    return "";
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ShowManagementRow({
  item,
  expanded,
  onToggle,
  actions,
}: {
  item: UpcomingItem;
  expanded: boolean;
  onToggle: () => void;
  actions?: ReactNode;
}) {
  const artists = item.lineup_artists?.length
    ? item.lineup_artists
    : [
        {
          name: item.artist,
          id: item.artist_id,
          slug: item.artist_slug,
          probable_setlist_status: item.probable_setlist_status,
          probable_setlist_generated_at: item.probable_setlist_generated_at,
          probable_setlist_song_count: item.probable_setlist_song_count,
          probable_setlist_source_show_count:
            item.probable_setlist_source_show_count,
          probable_setlist_mode: item.probable_setlist_mode,
          probable_setlist_tour_name: item.probable_setlist_tour_name,
        },
      ];
  const currentCount = artists.filter(
    (artist) => artist.probable_setlist_status === "fresh",
  ).length;
  const missingCount = artists.length - currentCount;
  const primary = artists.find(
    (artist) =>
      artist.name.trim().toLocaleLowerCase() ===
      item.artist.trim().toLocaleLowerCase(),
  );
  const artistHref = getArtistHref(primary);
  const artworkUrl =
    item.cover_url ||
    artistPhotoApiUrl({
      artistId: item.artist_id,
      artistSlug: item.artist_slug,
      artistName: item.artist,
    });
  const support = (item.lineup || []).slice(1);
  const countdown = showCountdown(item);
  const setlistSummary =
    artists.length === 1
      ? `${setlistLabel(artists[0]!)}${
          artists[0]!.probable_setlist_song_count
            ? ` · ${artists[0]!.probable_setlist_song_count} songs`
            : ""
        }${
          artists[0]!.probable_setlist_generated_at
            ? ` · updated ${timeAgo(artists[0]!.probable_setlist_generated_at)}`
            : ""
        }`
      : `${currentCount} / ${artists.length} setlists current${
          missingCount ? ` · ${missingCount} to review` : ""
        }`;
  return (
    <div className="space-y-2">
      {expanded ? (
        <div
          data-slot="show-management-ticket"
          className="relative flex h-full flex-col"
        >
          <section className="admin-show-ticket-top">
            <header className="relative px-5 pt-5 pb-6 sm:px-7 sm:pt-7">
              <div className="absolute top-2 right-2 z-10">
                <ActionGroup label="Show actions">
                  <ActionButton label="Close show details" onClick={onToggle}>
                    <X
                      data-admin-ux="upcoming-close-details"
                      size={CRATE_ICON_SIZE.md}
                    />
                  </ActionButton>
                </ActionGroup>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 pr-24">
                <MonoLabel
                  accent={countdown}
                  meta={[showDateLabel(item), item.time]}
                />
              </div>
              {artistHref ? (
                <Link
                  to={artistHref}
                  className="link-meta mt-4 block w-fit max-w-full font-display text-4xl font-extrabold leading-display tracking-display text-balance break-words text-text-primary sm:text-6xl"
                >
                  {item.artist}
                </Link>
              ) : (
                <h2 className="mt-4 w-fit max-w-full font-display text-4xl font-extrabold leading-display tracking-display text-balance break-words text-text-primary sm:text-6xl">
                  {item.artist}
                </h2>
              )}
              {support.length > 0 ? (
                <p className="mt-3 truncate text-sm text-text-muted">
                  With {support.slice(0, 4).join(" · ")}
                  {support.length > 4 ? ` +${support.length - 4}` : ""}
                </p>
              ) : null}
              <MonoLabel
                className="mt-5 text-text-secondary"
                meta={[
                  item.venue,
                  [item.address_line1, item.postal_code]
                    .filter(Boolean)
                    .join(" "),
                  [item.city, item.region, item.country]
                    .filter(Boolean)
                    .join(", "),
                ]}
              />
              <GenrePillRow
                items={(item.genres || []).map((name) => ({ name }))}
                max={3}
                className="mt-4"
              />
            </header>
          </section>
          <div aria-hidden="true" className="admin-show-ticket-perforation" />
          <section className="admin-show-ticket-bottom flex-1 px-5 pt-6 pb-5 sm:px-7 sm:pb-7">
            <MonoLabel
              as="h3"
              aria-label="Probable setlists by artist"
              tone="accent"
              meta={[
                `${artists.length} billed artists`,
                `${currentCount} current`,
              ]}
            >
              Probable setlists by artist
            </MonoLabel>
            <HairlineList
              as="ul"
              label="Probable setlists by artist"
              className="mt-3"
            >
              {artists.map((artist, index) => (
                <HairlineRow
                  key={`${artist.name}-${artist.id ?? "external"}`}
                  index={index + 1}
                  truncate={false}
                  trailing={
                    <InfoBadge
                      tone={setlistTone(artist.probable_setlist_status)}
                    >
                      {setlistLabel(artist)}
                    </InfoBadge>
                  }
                >
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-text-primary">
                      {artist.name}
                    </span>
                    <MonoLabel
                      as="span"
                      className="mt-1 block truncate"
                      meta={[
                        artist.probable_setlist_song_count
                          ? `${artist.probable_setlist_song_count} songs`
                          : "No songs available",
                        artist.probable_setlist_generated_at
                          ? `Updated ${timeAgo(artist.probable_setlist_generated_at)}`
                          : null,
                        artist.probable_setlist_source_show_count
                          ? `Based on ${artist.probable_setlist_source_show_count} shows`
                          : null,
                        artist.probable_setlist_tour_name
                          ? artist.probable_setlist_tour_name
                          : artist.probable_setlist_mode === "active_tour"
                            ? "Active tour estimate"
                            : null,
                      ]}
                    />
                  </div>
                </HairlineRow>
              ))}
            </HairlineList>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
              <div className="flex flex-wrap gap-2">{actions}</div>
              <ActionGroup label={`Actions for ${item.artist} show`}>
                {artistHref ? (
                  <ActionLink
                    label="Open artist"
                    href={artistHref}
                    data-admin-ux="show-management-open-artist"
                  >
                    <UserRound
                      data-admin-ux="upcoming-detail-open-artist"
                      size={CRATE_ICON_SIZE.md}
                    />
                  </ActionLink>
                ) : null}
                {item.url ? (
                  <ActionLink
                    label="Open show listing"
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    data-admin-ux="show-management-open-listing"
                  >
                    <ExternalLink
                      data-admin-ux="upcoming-detail-open-listing"
                      size={CRATE_ICON_SIZE.md}
                    />
                  </ActionLink>
                ) : null}
              </ActionGroup>
            </div>
          </section>
        </div>
      ) : (
        <UpcomingEventRow
          className="item-action-target relative overflow-hidden rounded-panel border border-border-quiet transition-colors duration-300 ease-snap hover:border-border-interactive motion-reduce:transition-none"
          actionsClassName="flex flex-col px-1.5"
          onToggle={onToggle}
          expanded={false}
          artwork={
            <MediaCover
              data-admin-ux="upcoming-show-cover"
              src={artworkUrl}
              alt=""
              fallbackIcon={Calendar}
              iconSize={CRATE_ICON_SIZE.xl}
              size={88}
              className="rounded-none"
            />
          }
          details={
            <>
              <span className="flex items-center gap-1.5">
                <span className="truncate text-caption font-semibold text-text-primary">
                  {item.artist}
                </span>
              </span>
              <MonoLabel
                as="span"
                className="mt-1 block truncate"
                meta={[item.venue, item.city]}
              />
              {support.length > 0 ? (
                <MonoLabel as="span" className="mt-0.5 block truncate">
                  With {support.slice(0, 3).join(", ")}
                  {support.length > 3 ? ` +${support.length - 3}` : ""}
                </MonoLabel>
              ) : null}
              <TooltipHint
                content={artists
                  .map((artist) => `${artist.name}: ${setlistLabel(artist)}`)
                  .join(" · ")}
              >
                <MonoLabel
                  as="span"
                  className="mt-1 block min-w-0 truncate"
                  accent={countdown}
                  meta={[setlistSummary]}
                />
              </TooltipHint>
            </>
          }
          date={<UpcomingDateStamp date={item.date} locale="en-US" />}
          actions={
            <ActionGroup label={`Actions for ${item.artist} show`}>
              {artistHref ? (
                <ActionLink
                  label="Open artist"
                  href={artistHref}
                  onClick={(event) => event.stopPropagation()}
                  data-admin-ux="show-management-open-artist"
                >
                  <UserRound
                    data-admin-ux="upcoming-row-open-artist"
                    size={CRATE_ICON_SIZE.md}
                  />
                </ActionLink>
              ) : null}
              {item.url ? (
                <ActionLink
                  label="Open show listing"
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  data-admin-ux="show-management-open-listing"
                >
                  <ExternalLink
                    data-admin-ux="upcoming-row-open-listing"
                    size={CRATE_ICON_SIZE.md}
                  />
                </ActionLink>
              ) : null}
            </ActionGroup>
          }
        />
      )}
    </div>
  );
}
