import { type ReactNode, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Calendar, Loader2, Sparkles } from "@crate/ui/icons";

import { useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import {
  groupByMonth,
  itemKey,
  UpcomingMonthGroup,
  UpcomingShowCard,
  type UpcomingItem,
} from "@/components/upcoming/UpcomingRows";

interface UpcomingResponse {
  items: UpcomingItem[];
  summary: {
    followed_artists: number;
    show_count: number;
    release_count: number;
    attending_count: number;
    insight_count: number;
  };
}

interface GenreShowsResponse {
  name: string;
  slug: string;
  shows?: UpcomingItem[];
}

type Filter = "all" | "shows" | "releases";

export function Shows() {
  const [searchParams] = useSearchParams();
  const genreSlug = searchParams.get("genre");
  const focusShowId = searchParams.get("show");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data, loading: upcomingLoading } = useApi<UpcomingResponse>(
    genreSlug ? null : "/api/me/upcoming",
  );
  const { data: genreData, loading: genreLoading } = useApi<GenreShowsResponse>(
    genreSlug ? `/api/genres/${genreSlug}?view=genre-detail-v5` : null,
  );

  const isGenreRadar = Boolean(genreSlug);
  const items = isGenreRadar ? genreData?.shows ?? [] : data?.items ?? [];
  const loading = isGenreRadar ? genreLoading : upcomingLoading;
  const summary = isGenreRadar
    ? {
        followed_artists: 0,
        show_count: items.length,
        release_count: 0,
        attending_count: 0,
        insight_count: 0,
      }
    : data?.summary;

  const filtered = useMemo(() => {
    let next = items;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      next = next.filter(
        (item) =>
          item.artist.toLowerCase().includes(q) ||
          item.title.toLowerCase().includes(q) ||
          item.subtitle.toLowerCase().includes(q),
      );
    }
    if (filter === "shows") next = next.filter((item) => item.type === "show");
    if (filter === "releases")
      next = next.filter((item) => item.type === "release");
    return next;
  }, [filter, items, search]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const attendingShows = items.filter(
    (item) => item.type === "show" && item.user_attending,
  );
  const nextAttendingShow = attendingShows
    .filter((item) => item.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const focusedGenreShow = isGenreRadar
    ? items.find(
        (item) => item.type === "show" && String(item.id) === focusShowId,
      ) || items.find((item) => item.type === "show")
    : null;
  const featuredCandidate = focusedGenreShow || nextAttendingShow || null;
  const featuredShow =
    featuredCandidate &&
    filter !== "releases" &&
    filtered.some((item) => isSameUpcomingItem(item, featuredCandidate))
      ? featuredCandidate
      : null;
  const comingUp = filtered
    .filter((item) => item.is_upcoming || item.date >= today)
    .filter((item) => !featuredShow || !isSameUpcomingItem(item, featuredShow));
  const recentlyReleased = filtered
    .filter(
      (item) =>
        item.type === "release" && !item.is_upcoming && item.date < today,
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const hasFollowedArtists =
    isGenreRadar || (summary?.followed_artists ?? 0) > 0;
  const headingCopy = isGenreRadar
    ? `Upcoming ${
        genreData?.name || genreSlug
      } shows near your concert location.`
    : "Shows, releases, and signals from artists you follow, with the latest releases you might have missed.";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Radar</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {headingCopy}
          </p>
        </div>

        <div
          role="list"
          aria-label="Radar summary"
          className="hidden flex-wrap items-center gap-2 md:flex"
        >
          {summary && !isGenreRadar ? (
            <>
              <SummaryPill
                label="Followed artists"
                value={summary.followed_artists}
              />
              <SummaryPill
                label="Shows"
                value={summary.show_count}
                accent="cyan"
              />
              <SummaryPill
                label="Releases"
                value={summary.release_count}
                accent="cyan"
              />
              <SummaryPill
                label="Attending"
                value={attendingShows.length}
                accent="cyan"
              />
            </>
          ) : summary ? (
            <SummaryPill
              label="Shows"
              value={summary.show_count}
              accent="cyan"
            />
          ) : null}
        </div>
      </div>

      {featuredShow ? (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Calendar size={15} className="text-primary" />
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
              Next show
            </h2>
          </div>
          <UpcomingShowCard
            item={featuredShow}
            expanded
            featured
            showClose={false}
            onToggle={() => undefined}
          />
        </section>
      ) : null}

      <div className="flex flex-col gap-3 rounded-[1.25rem] border border-white/5 bg-white/[0.02] p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "shows", "releases"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-full border px-4 py-2 text-sm transition-colors",
                filter === value
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-white/10 text-muted-foreground hover:border-white/20 hover:text-foreground",
              )}
            >
              {value === "all"
                ? "All"
                : value === "shows"
                  ? "Shows"
                  : "Releases"}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-[280px]">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by artist, venue, city..."
            className="h-11 w-full rounded-2xl border border-white/10 bg-input px-4 text-sm text-foreground placeholder:text-white/40 focus:border-primary/40 focus:outline-none"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 size={24} className="animate-spin text-primary" />
        </div>
      ) : null}

      {!loading && isGenreRadar && items.length === 0 ? (
        <EmptyState
          icon={<Calendar size={22} className="text-primary" />}
          title="No genre shows near your show location"
          body="Crate will show upcoming shows here when this genre has nearby artists on your Radar."
        />
      ) : null}

      {!loading && !isGenreRadar && !hasFollowedArtists ? (
        <EmptyState
          icon={<Sparkles size={22} className="text-primary" />}
          title="Follow some artists to unlock Radar"
          body="As soon as you follow artists, Radar will show their upcoming shows and new releases here."
        />
      ) : null}

      {!loading &&
      hasFollowedArtists &&
      items.length > 0 &&
      filtered.length === 0 ? (
        <EmptyState
          icon={<Calendar size={22} className="text-primary" />}
          title="Nothing matches your filters"
          body="Try another search or switch between shows and releases."
        />
      ) : null}

      {!loading && hasFollowedArtists && filtered.length > 0 ? (
        <div className="space-y-10">
          {comingUp.length > 0 ? (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-primary" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
                  Coming up
                </h2>
              </div>
              <div className="space-y-8">
                {groupByMonth(comingUp).map(([month, monthItems]) => (
                  <UpcomingMonthGroup
                    key={month}
                    month={month}
                    items={monthItems}
                    expandedId={expandedId}
                    onToggleExpand={setExpandedId}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {recentlyReleased.length > 0 ? (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Calendar size={15} className="text-muted-foreground" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Recently released
                </h2>
              </div>
              <div className="space-y-8">
                {groupByMonth(recentlyReleased).map(([month, monthItems]) => (
                  <UpcomingMonthGroup
                    key={month}
                    month={month}
                    items={monthItems}
                    expandedId={expandedId}
                    onToggleExpand={setExpandedId}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SummaryPill({
  label,
  value,
  accent = "neutral",
}: {
  label: string;
  value: number;
  accent?: "neutral" | "cyan";
}) {
  const accentClass =
    accent === "cyan"
      ? "border-primary/20 text-primary"
      : "border-white/10 text-white/60";

  return (
    <div
      role="listitem"
      className={cn(
        "rounded-2xl border bg-white/[0.03] px-3 py-2",
        accentClass,
      )}
    >
      <div className="text-[10px] uppercase tracking-[0.16em] opacity-70">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function isSameUpcomingItem(left: UpcomingItem, right: UpcomingItem) {
  if (left.event_key && right.event_key) {
    return left.event_key === right.event_key;
  }
  if (left.id != null && right.id != null && left.type === right.type) {
    return left.id === right.id;
  }
  return itemKey(left, 0) === itemKey(right, 0);
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[1.5rem] border border-white/5 bg-white/[0.02] px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
        {icon}
      </div>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        {body}
      </p>
    </div>
  );
}
