import { Link } from "react-router";
import { Calendar, ChevronDown, Disc3, ExternalLink, Play } from "lucide-react";

import {
  albumPagePath,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

import type { UpcomingItem } from "./upcoming-model";

export function UpcomingEventRow({
  item,
  expanded = false,
  onToggle,
}: {
  item: UpcomingItem;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const dateObj = item.date ? new Date(`${item.date}T12:00:00`) : null;
  const dateStr = dateObj
    ? dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "";
  const coverUrl =
    item.cover_url ||
    artistPhotoApiUrl(
      {
        artistId: item.artist_id,
        artistSlug: item.artist_slug,
        artistName: item.artist,
      },
      { size: 800 },
    ) ||
    undefined;
  const albumPath =
    item.album_id || item.album_slug
      ? albumPagePath({
          albumId: item.album_id,
          albumSlug: item.album_slug,
          albumName: item.title,
          artistSlug: item.artist_slug,
          artistName: item.artist,
        })
      : null;
  const artistPath = artistPagePath({
    artistId: item.artist_id,
    artistSlug: item.artist_slug,
    artistName: item.artist,
  });

  return (
    <article
      role={onToggle ? "button" : undefined}
      tabIndex={onToggle ? 0 : undefined}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (!onToggle) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
      className="group relative overflow-hidden rounded-3xl border border-primary/10 bg-white/[0.025] p-4 text-left transition-all hover:border-primary/25 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_20%,rgba(6,182,212,0.22),transparent_34%),linear-gradient(90deg,rgba(255,255,255,0.06),transparent_58%)]" />
      {coverUrl ? (
        <img
          src={coverUrl}
          alt=""
          loading="lazy"
          className="absolute inset-y-0 right-0 h-full w-1/2 object-cover opacity-[0.24] grayscale transition-opacity group-hover:opacity-[0.34]"
          onError={(event) => {
            (event.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : null}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,11,16,0.96),rgba(10,11,16,0.78)_48%,rgba(10,11,16,0.38)),linear-gradient(0deg,rgba(10,11,16,0.84),transparent_55%)]" />

      <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/5">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
                onError={(event) => {
                  (event.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-primary">
                <Disc3 size={24} />
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
              <Disc3 size={11} />
              Pre-release
            </div>
            <h3 className="truncate text-lg font-extrabold text-foreground">
              {item.title}
            </h3>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <Link
                to={artistPath}
                className="truncate transition-colors hover:text-foreground"
              >
                {item.artist}
              </Link>
              <span className="text-white/20">&middot;</span>
              <span className="truncate">{item.subtitle}</span>
              {item.status ? (
                <>
                  <span className="text-white/20">&middot;</span>
                  <span className="capitalize text-primary/90">
                    {item.status}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 md:justify-end">
          {dateStr ? (
            <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm font-semibold text-primary backdrop-blur">
              <Calendar size={14} />
              {dateStr}
            </div>
          ) : null}
          {albumPath ? (
            <Link
              to={albumPath}
              onClick={(event) => event.stopPropagation()}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Play size={14} className="fill-current" />
              Open pre-release
            </Link>
          ) : null}
          {item.tidal_url ? (
            <a
              href={item.tidal_url}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-white/[0.1]"
            >
              <ExternalLink size={14} />
              Source
            </a>
          ) : null}
          {onToggle ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggle();
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] text-foreground transition-colors hover:bg-white/[0.1]"
              aria-label={
                expanded ? "Hide release details" : "Show release details"
              }
            >
              <ChevronDown
                size={16}
                className={`transition-transform ${
                  expanded ? "rotate-180" : ""
                }`}
              />
            </button>
          ) : null}
        </div>
      </div>
      {expanded ? (
        <div className="relative mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                Discography radar
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/68">
                This release is tracked as a pre-release album. Open it to see
                the full planned tracklist; tracks become playable as soon as
                Crate has downloaded or matched them locally.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {albumPath ? (
                <Link
                  to={albumPath}
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Play size={14} className="fill-current" />
                  Open album view
                </Link>
              ) : null}
              <Link
                to={artistPath}
                onClick={(event) => event.stopPropagation()}
                className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-white/[0.1]"
              >
                Artist
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
