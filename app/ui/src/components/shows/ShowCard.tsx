import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { ExternalLink, X, UserRound, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { GenrePillRow } from "@crate/ui/domain/genres/GenrePill";
import {
  ActionButton,
  ActionGroup,
  ActionLink,
} from "@crate/ui/primitives/ActionGroup";

import {
  artistBackgroundApiUrl,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";
import { cn } from "@/lib/utils";
import { OpsSurface } from "@/components/admin/ops-surfaces";

const COLLAPSED_HEIGHT = 88;

interface ShowArtistRef {
  name: string;
  id?: number;
  slug?: string;
}

export interface ShowEvent {
  id: string;
  name: string;
  date: string;
  local_date: string;
  local_time: string;
  venue: string;
  address_line1?: string;
  city: string;
  region: string;
  country: string;
  country_code: string;
  url: string;
  image: string;
  lineup: string[];
  price_range?: { min: number; max: number; currency: string } | null;
  status: string;
  latitude?: string;
  longitude?: string;
  artist_name?: string;
  artist_id?: number;
  artist_slug?: string;
  lineup_artists?: ShowArtistRef[];
  artist_listeners?: number;
  artist_genres?: string[];
}

interface AdminShowCardItem {
  type?: "show" | "release";
  date: string;
  time?: string;
  artist: string;
  artist_id?: number;
  artist_slug?: string;
  title?: string;
  cover_url?: string | null;
  status?: string;
  url?: string;
  venue?: string;
  address_line1?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
  lineup?: string[];
  lineup_artists?: ShowArtistRef[];
  genres?: string[];
}

type ShowCardInput = ShowEvent | AdminShowCardItem;

interface NormalizedShow {
  id?: string | number;
  date: string;
  time: string;
  venue: string;
  addressLine1: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  url: string;
  status: string;
  title: string;
  primaryArtist: ShowArtistRef | null;
  lineupArtists: ShowArtistRef[];
  genres: string[];
  coverUrl: string;
  artistPhotoUrl: string;
  backgroundUrl: string;
}

function getArtistLink(artist: ShowArtistRef | null | undefined) {
  if (!artist || artist.id == null) return undefined;
  return artistPagePath({
    artistId: artist.id,
    artistSlug: artist.slug,
    artistName: artist.name,
  });
}

function formatDateParts(date: string, time: string) {
  if (!date)
    return { dateLabel: "", monthLabel: "", dayLabel: "", weekdayLabel: "" };
  const value = new Date(`${date}T12:00:00`);
  return {
    dateLabel: value.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    monthLabel: value
      .toLocaleDateString("en-US", { month: "short" })
      .toUpperCase(),
    dayLabel: String(value.getDate()),
    weekdayLabel: value
      .toLocaleDateString("en-US", { weekday: "short" })
      .toUpperCase(),
    timeLabel: time ? time.slice(0, 5) : "",
  };
}

function normalizeLineupArtists(
  show: ShowCardInput,
  primaryArtist: ShowArtistRef | null,
) {
  const raw = show as Partial<ShowEvent & AdminShowCardItem>;
  const rawLineupArtists = Array.isArray(raw.lineup_artists)
    ? raw.lineup_artists.filter(
        (artist): artist is ShowArtistRef =>
          Boolean(artist) &&
          typeof artist.name === "string" &&
          artist.name.length > 0,
      )
    : [];
  const rawLineup = Array.isArray(raw.lineup)
    ? raw.lineup.filter(
        (artist): artist is string =>
          typeof artist === "string" && artist.length > 0,
      )
    : [];

  const lineup: ShowArtistRef[] =
    rawLineupArtists.length > 0
      ? rawLineupArtists
      : rawLineup.map((name) => ({ name }));

  if (
    primaryArtist &&
    !lineup.some(
      (artist) =>
        artist.name === primaryArtist.name && artist.id === primaryArtist.id,
    )
  ) {
    return [primaryArtist, ...lineup];
  }
  return lineup.length > 0 ? lineup : primaryArtist ? [primaryArtist] : [];
}

function normalizeShow(show: ShowCardInput): NormalizedShow {
  const raw = show as Partial<ShowEvent & AdminShowCardItem>;
  const artistName =
    typeof raw.artist === "string"
      ? raw.artist
      : typeof raw.artist_name === "string"
        ? raw.artist_name
        : Array.isArray(raw.lineup) && typeof raw.lineup[0] === "string"
          ? raw.lineup[0]
          : typeof raw.name === "string"
            ? raw.name
            : "Unknown Artist";
  const primaryArtist: ShowArtistRef | null = artistName
    ? {
        name: artistName,
        id: typeof raw.artist_id === "number" ? raw.artist_id : undefined,
        slug: typeof raw.artist_slug === "string" ? raw.artist_slug : undefined,
      }
    : null;
  const lineupArtists = normalizeLineupArtists(show, primaryArtist);
  const coverUrl =
    typeof raw.cover_url === "string" && raw.cover_url.length > 0
      ? raw.cover_url
      : typeof raw.image === "string" && raw.image.length > 0
        ? raw.image
        : "";
  const artistPhotoUrl =
    primaryArtist && primaryArtist.id != null
      ? artistPhotoApiUrl({
          artistId: primaryArtist.id,
          artistSlug: primaryArtist.slug,
          artistName: primaryArtist.name,
        }) || coverUrl
      : coverUrl;
  const backgroundUrl =
    primaryArtist && primaryArtist.id != null
      ? artistBackgroundApiUrl({
          artistId: primaryArtist.id,
          artistSlug: primaryArtist.slug,
          artistName: primaryArtist.name,
        }) || ""
      : "";

  return {
    id:
      typeof raw.id === "number" || typeof raw.id === "string"
        ? raw.id
        : undefined,
    date: typeof raw.date === "string" ? raw.date.slice(0, 10) : "",
    time:
      typeof raw.time === "string"
        ? raw.time
        : typeof raw.local_time === "string"
          ? raw.local_time
          : "",
    venue: typeof raw.venue === "string" ? raw.venue : "",
    addressLine1:
      typeof raw.address_line1 === "string" ? raw.address_line1 : "",
    city: typeof raw.city === "string" ? raw.city : "",
    region: typeof raw.region === "string" ? raw.region : "",
    postalCode: typeof raw.postal_code === "string" ? raw.postal_code : "",
    country: typeof raw.country === "string" ? raw.country : "",
    url: typeof raw.url === "string" ? raw.url : "",
    status: typeof raw.status === "string" ? raw.status : "onsale",
    title:
      typeof raw.title === "string" && raw.title.length > 0
        ? raw.title
        : typeof raw.name === "string"
          ? raw.name
          : "",
    primaryArtist,
    lineupArtists,
    genres: Array.isArray(raw.genres)
      ? raw.genres.filter(
          (genre): genre is string =>
            typeof genre === "string" && genre.length > 0,
        )
      : Array.isArray(raw.artist_genres)
        ? raw.artist_genres.filter(
            (genre): genre is string =>
              typeof genre === "string" && genre.length > 0,
          )
        : [],
    coverUrl,
    artistPhotoUrl,
    backgroundUrl,
  };
}

function CompactCard({ show }: { show: ShowEvent }) {
  const normalized = normalizeShow(show);
  return (
    <div className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors ">
      <div className="crate-media-thumbnail size-12 flex-shrink-0 overflow-hidden rounded-sm bg-white/5">
        {normalized.artistPhotoUrl ? (
          <img
            src={normalized.artistPhotoUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={(event) => {
              (event.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
      </div>
      <span className="truncate font-medium">
        {normalized.primaryArtist?.name ?? normalized.title}
      </span>
      <span className="hidden truncate text-muted-foreground sm:inline">
        {normalized.venue}
      </span>
    </div>
  );
}

function PreloadBackground({ show }: { show: NormalizedShow }) {
  if (!show.backgroundUrl) return null;
  return <img src={show.backgroundUrl} alt="" className="hidden" />;
}

function CollapsedShowCard({ show }: { show: NormalizedShow }) {
  const { monthLabel, dayLabel, weekdayLabel } = formatDateParts(
    show.date,
    show.time,
  );
  const support = show.lineupArtists.slice(1);

  return (
    <div className="absolute inset-x-0 top-0 z-10 flex h-full items-center gap-0">
      <PreloadBackground show={show} />
      <div className="h-full w-[88px] flex-shrink-0 bg-white/5">
        {show.artistPhotoUrl ? (
          <img
            src={show.artistPhotoUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(event) => {
              (event.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1 px-3 py-2.5">
        <div
          data-slot="entity-title"
          className="font-display truncate text-[13px] font-semibold text-foreground"
        >
          {show.primaryArtist?.name ?? show.title}
        </div>
        <div className="mt-1 flex items-center gap-1 text-[11px] text-white/40">
          <span className="truncate">{show.venue}</span>
          {show.city ? (
            <>
              <span className="text-white/15">&middot;</span>
              <span className="flex-shrink-0">{show.city}</span>
            </>
          ) : null}
        </div>
        {support.length > 0 ? (
          <div className="mt-0.5 truncate text-[10px] text-white/40">
            w/{" "}
            {support
              .slice(0, 3)
              .map((artist) => artist.name)
              .join(", ")}
            {support.length > 3 ? ` +${support.length - 3}` : ""}
          </div>
        ) : null}
      </div>

      <div className="flex flex-shrink-0 flex-col items-center justify-center px-2">
        <span className="font-mono text-[8px] font-normal leading-none tracking-[0.12em] text-primary/55">
          {monthLabel}
        </span>
        <span className="font-mono text-[20px] font-normal leading-tight text-primary">
          {dayLabel}
        </span>
        <span className="font-mono text-[8px] font-normal leading-none text-white/40">
          {weekdayLabel}
        </span>
      </div>

      <div className="flex flex-shrink-0 flex-col items-center gap-1 pr-2">
        {show.url ? (
          <a
            href={show.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            title="Open tickets"
            className="flex h-11 w-11 items-center justify-center rounded-md text-white/30 transition-colors hover:bg-white/8 hover:text-white/70"
          >
            <ExternalLink
              data-admin-ux="show-tickets-external"
              aria-hidden="true"
              size={15}
            />
          </a>
        ) : (
          <div className="h-8 w-8" />
        )}
      </div>
    </div>
  );
}

function ExpandedShowCardBody({
  show,
  closeable,
  onClose,
  actions,
}: {
  show: NormalizedShow;
  closeable?: boolean;
  onClose?: () => void;
  actions?: ReactNode;
}) {
  const { dateLabel, timeLabel } = formatDateParts(
    show.date,
    show.time,
  ) as ReturnType<typeof formatDateParts> & { timeLabel?: string };
  const support = show.lineupArtists.slice(1);
  const locationLabel = [show.city, show.region, show.country]
    .filter(Boolean)
    .join(", ");
  const addressLabel = [show.addressLine1, show.postalCode]
    .filter(Boolean)
    .join(" · ");
  const artistHref = getArtistLink(show.primaryArtist);
  const name = show.primaryArtist?.name ?? show.title;

  return (
    <article
      className="flex min-w-0 flex-col gap-4 p-4"
      aria-label={`${name} show preview`}
    >
      <div className="flex items-start justify-between gap-3">
        <MonoLabel as="div" tone="accent" meta={[dateLabel, timeLabel]} />
        {closeable ? (
          <ActionGroup label="Close show preview">
            <ActionButton label="Close show details" onClick={onClose}>
              <X
                data-admin-ux="show-close"
                aria-hidden="true"
                size={CRATE_ICON_SIZE.md}
              />
            </ActionButton>
          </ActionGroup>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <MediaCover
          src={show.coverUrl || show.artistPhotoUrl || show.backgroundUrl}
          alt={name}
          className="size-16 shrink-0"
        />
        <div className="min-w-0">
          <h3 className="break-words font-display text-2xl font-bold leading-tight text-text-primary">
            {artistHref ? (
              <Link to={artistHref} className="hover:text-accent-action-hi">
                {name}
              </Link>
            ) : (
              name
            )}
          </h3>
          {support.length > 0 ? (
            <p className="m-0 mt-1 text-sm text-text-muted">
              With{" "}
              {support
                .slice(0, 4)
                .map((artist) => artist.name)
                .join(" · ")}
              {support.length > 4 ? ` +${support.length - 4}` : ""}
            </p>
          ) : null}
        </div>
      </div>
      <MonoLabel as="div" meta={[show.venue, addressLabel, locationLabel]} />
      <GenrePillRow
        items={show.genres.map((genre) => ({ name: genre }))}
        max={3}
      />
      <ActionGroup label="Show preview actions">
        {artistHref ? (
          <ActionLink href={artistHref} label="Open artist">
            <UserRound
              data-admin-ux="show-preview-open-artist"
              aria-hidden="true"
              size={CRATE_ICON_SIZE.md}
            />
          </ActionLink>
        ) : null}
        {show.url ? (
          <ActionLink
            href={show.url}
            label="Get tickets"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink
              data-admin-ux="show-preview-tickets"
              aria-hidden="true"
              size={CRATE_ICON_SIZE.md}
            />
          </ActionLink>
        ) : null}
      </ActionGroup>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </article>
  );
}

export function ShowCard({
  show,
  compact,
  expanded,
  onToggle,
  actions,
  className,
}: {
  show: ShowCardInput;
  compact?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  /** Extra controls for the expanded detail, e.g. curator actions. */
  actions?: ReactNode;
  className?: string;
}) {
  const normalized = useMemo(() => normalizeShow(show), [show]);
  const isInteractive =
    typeof expanded === "boolean" && typeof onToggle === "function";
  const contentRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number>(0);

  const measure = useCallback(() => {
    if (contentRef.current) {
      setMeasuredHeight(contentRef.current.scrollHeight);
    }
  }, []);

  useEffect(() => {
    if (isInteractive && expanded) measure();
  }, [expanded, isInteractive, measure]);

  if (compact) return <CompactCard show={show as ShowEvent} />;

  if (!isInteractive) {
    return (
      <OpsSurface
        className={cn("relative w-[340px] overflow-hidden", className)}
      >
        <ExpandedShowCardBody show={normalized} />
      </OpsSurface>
    );
  }

  const cardHeight = expanded
    ? measuredHeight > 0
      ? measuredHeight
      : "auto"
    : COLLAPSED_HEIGHT;

  return (
    <OpsSurface
      className={cn(
        "relative w-full overflow-hidden transition-[height,border-color] duration-300 ease-out",
        expanded
          ? "border-accent-action-hi/40"
          : "hover:border-accent-action-hi/40",
        className,
      )}
      style={{ height: cardHeight }}
      role={!expanded ? "button" : undefined}
      tabIndex={!expanded ? 0 : undefined}
      aria-expanded={!expanded ? expanded : undefined}
      onClick={!expanded ? onToggle : undefined}
      onKeyDown={
        !expanded && onToggle
          ? (event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onToggle();
              }
            }
          : undefined
      }
    >
      <div ref={contentRef}>
        {!expanded ? (
          <CollapsedShowCard show={normalized} />
        ) : (
          <ExpandedShowCardBody
            show={normalized}
            closeable
            onClose={onToggle}
            actions={actions}
          />
        )}
      </div>
    </OpsSurface>
  );
}
