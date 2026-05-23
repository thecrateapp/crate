import { Link } from "react-router";
import {
  Calendar,
  Disc3,
  ExternalLink,
  MapPin,
  Play,
  RadioTower,
  Sparkles,
} from "lucide-react";

import {
  albumPagePath,
  artistBackgroundApiUrl,
  artistPagePath,
  artistPhotoApiUrl,
} from "@/lib/library-routes";

import type {
  HomeUpcomingInsight,
  HomeUpcomingItem,
  HomeUpcomingResponse,
} from "./home-model";
import { SectionHeader, UpcomingPreviewRow } from "./HomeSections";

function formatUpcomingDate(date?: string): string | null {
  if (!date) return null;
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
}

function insightLabel(type: HomeUpcomingInsight["type"]): string {
  if (type === "show_prep") return "Show prep";
  if (type === "one_week") return "This week";
  return "One month";
}

export function HomeUpcomingSection({
  previewItems,
  summary,
  onOpenUpcoming,
  onPlaySetlist,
}: {
  previewItems: HomeUpcomingItem[];
  summary?: HomeUpcomingResponse["summary"];
  onOpenUpcoming: () => void;
  onPlaySetlist?: (item: HomeUpcomingItem) => void;
}) {
  const nextUpcoming = previewItems[0] || null;
  if (!nextUpcoming) return null;

  const isShow = nextUpcoming.type === "show";
  const nextUpcomingDate = formatUpcomingDate(nextUpcoming.date);
  const artistImage =
    nextUpcoming.cover_url ||
    artistBackgroundApiUrl(
      {
        artistId: nextUpcoming.artist_id,
        artistSlug: nextUpcoming.artist_slug,
        artistName: nextUpcoming.artist,
      },
      { size: 1200 },
    ) ||
    artistPhotoApiUrl(
      {
        artistId: nextUpcoming.artist_id,
        artistSlug: nextUpcoming.artist_slug,
        artistName: nextUpcoming.artist,
      },
      { size: 800 },
    );
  const releasePath =
    !isShow && (nextUpcoming.album_id || nextUpcoming.album_slug)
      ? albumPagePath({
          albumId: nextUpcoming.album_id,
          albumSlug: nextUpcoming.album_slug,
          albumName: nextUpcoming.title,
          artistSlug: nextUpcoming.artist_slug,
          artistName: nextUpcoming.artist,
        })
      : null;
  const artistPath = artistPagePath({
    artistId: nextUpcoming.artist_id,
    artistSlug: nextUpcoming.artist_slug,
    artistName: nextUpcoming.artist,
  });

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Upcoming"
        subtitle="Next shows and releases from the artists you follow."
        actionLabel="Open Upcoming"
        onAction={onOpenUpcoming}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <div className="relative min-h-[270px] overflow-hidden rounded-[28px] border border-white/10 bg-[#101218] p-5 sm:p-6">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(6,182,212,0.34),transparent_35%),linear-gradient(120deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))]" />
          {artistImage ? (
            <img
              src={artistImage}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover opacity-40 grayscale"
              onError={(event) => {
                (event.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : null}
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,9,13,0.94),rgba(8,9,13,0.64)_48%,rgba(8,9,13,0.18)),linear-gradient(0deg,rgba(8,9,13,0.9),transparent_55%)]" />

          <div className="relative flex min-h-[222px] flex-col justify-between">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/12 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-primary">
                {isShow ? <RadioTower size={12} /> : <Disc3 size={12} />}
                {isShow ? "Next show" : "Next release"}
              </div>

              <h2 className="max-w-3xl text-3xl font-extrabold leading-none tracking-tight text-foreground sm:text-4xl">
                {isShow ? nextUpcoming.artist : nextUpcoming.title}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">
                {isShow
                  ? `${nextUpcoming.title} · ${nextUpcoming.subtitle}`
                  : `${nextUpcoming.artist} · ${nextUpcoming.subtitle}`}
              </p>
            </div>

            <div>
              <div className="mb-4 flex flex-wrap gap-2">
                {nextUpcomingDate ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.07] px-3 py-2 backdrop-blur">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">
                      Date
                    </div>
                    <div className="mt-1 text-sm font-semibold text-foreground">
                      {nextUpcomingDate}
                    </div>
                  </div>
                ) : null}
                {isShow && nextUpcoming.venue ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.07] px-3 py-2 backdrop-blur">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">
                      Venue
                    </div>
                    <div className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-foreground">
                      <MapPin size={12} className="text-primary" />
                      {nextUpcoming.venue}
                    </div>
                  </div>
                ) : null}
                {!isShow && nextUpcoming.status ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.07] px-3 py-2 backdrop-blur">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">
                      State
                    </div>
                    <div className="mt-1 text-sm font-semibold capitalize text-foreground">
                      {nextUpcoming.status}
                    </div>
                  </div>
                ) : null}
                {nextUpcoming.user_attending && isShow ? (
                  <div className="rounded-2xl border border-primary/20 bg-primary/12 px-3 py-2 text-sm font-semibold text-primary backdrop-blur">
                    Going
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {isShow && onPlaySetlist ? (
                  <button
                    onClick={() => onPlaySetlist(nextUpcoming)}
                    disabled={!nextUpcoming.probable_setlist?.length}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Play size={15} className="fill-current" />
                    Play probable setlist
                  </button>
                ) : null}
                {!isShow && releasePath ? (
                  <Link
                    to={releasePath}
                    className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Play size={15} className="fill-current" />
                    Open album
                  </Link>
                ) : null}
                <button
                  onClick={onOpenUpcoming}
                  className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-white/[0.1]"
                >
                  <Calendar size={15} />
                  View radar
                </button>
                {!isShow && nextUpcoming.tidal_url ? (
                  <a
                    href={nextUpcoming.tidal_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-white/[0.1]"
                  >
                    <ExternalLink size={15} />
                    Open source
                  </a>
                ) : null}
                {isShow && artistPath ? (
                  <Link
                    to={artistPath}
                    className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-white/[0.1]"
                  >
                    Artist
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/40">
              <Calendar size={12} />
              Next up
            </div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-primary">
              {summary?.show_count ?? 0} shows · {summary?.release_count ?? 0}{" "}
              releases
            </div>
          </div>
          <div className="space-y-1">
            {previewItems.map((item) => (
              <UpcomingPreviewRow
                key={`${item.type}-${item.artist}-${item.title}-${item.date}`}
                item={item}
                onClick={onOpenUpcoming}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function HomeShowPrepSection({
  insights,
  onOpenUpcoming,
  onPlaySetlist,
  onSaveReminder,
}: {
  insights: HomeUpcomingInsight[];
  onOpenUpcoming: () => void;
  onPlaySetlist: (insight: HomeUpcomingInsight) => void;
  onSaveReminder: (insight: HomeUpcomingInsight) => void;
}) {
  if (!insights.length) return null;

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Show prep"
        subtitle="A couple of timely prompts from the shows you're planning to attend."
        actionLabel="Open Upcoming"
        onAction={onOpenUpcoming}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {insights.map((insight) => (
          <div
            key={`${insight.type}:${insight.show_id}`}
            className="rounded-[24px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.16),transparent_42%),rgba(255,255,255,0.03)] p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
                  <Sparkles size={12} />
                  {insightLabel(insight.type)}
                </div>
                <h3 className="mt-3 text-lg font-bold text-foreground">
                  {insight.title}
                </h3>
                <p className="mt-1 text-sm text-white/60">{insight.subtitle}</p>
              </div>
              {insight.weight === "high" ? (
                <div className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] uppercase tracking-[0.16em] text-primary">
                  Heavy rotation
                </div>
              ) : null}
            </div>

            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              {insight.message}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {insight.has_setlist ? (
                <button
                  onClick={() => onPlaySetlist(insight)}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Play size={14} fill="currentColor" />
                  Play probable setlist
                </button>
              ) : null}
              <button
                onClick={() => onSaveReminder(insight)}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-sm text-white/65 transition-colors hover:border-white/20 hover:text-foreground"
              >
                <Calendar size={14} />
                Save for later
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
