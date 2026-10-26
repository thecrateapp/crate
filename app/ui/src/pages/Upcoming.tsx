import { OpsPageHero, OpsSurface } from "@/components/admin/ops-surfaces";
import { Calendar, ListOrdered as HeaderList } from "@crate/ui/icons";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import {
  PageHeaderAction,
  PageHeaderActions,
} from "@/components/layout/PageHeader";
import {
  CalendarSync as HeaderCalendarSync,
  Loader2,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import {
  useState,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router";
import { AddShowButton } from "@/components/shows/AddShowButton";
import { MergeShowsButton } from "@/components/shows/MergeShowsButton";
import { MergeShowsSheet } from "@/components/shows/MergeShowsSheet";
import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { ListPagination } from "@/components/admin/ListPagination";

import { Button } from "@crate/ui/shadcn/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@crate/ui/shadcn/popover";
import { ShowCard } from "@/components/shows/ShowCard";
import { api } from "@/lib/api";
import { waitForTask } from "@/lib/tasks";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import "./upcoming-show-ticket.css";
import {
  buildUpcomingCityOptions,
  buildUpcomingGenreOptions,
  filterUpcomingItems,
  sameShowIds,
} from "./upcoming-filters";
import { toast } from "sonner";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import {
  ShowManagementRow,
  upcomingItemFromCachedShow,
  type CachedShowEvent,
  type UpcomingItem,
} from "@/components/shows/ShowManagementRow";

function groupByMonth(list: UpcomingItem[]): [string, UpcomingItem[]][] {
  const groups = new Map<string, UpcomingItem[]>();
  for (const item of list) {
    const month = (item.date || "").slice(0, 7) || "Unknown";
    const existing = groups.get(month) || [];
    existing.push(item);
    groups.set(month, existing);
  }
  return [...groups.entries()];
}

// Fix Leaflet default marker icon
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)
  ._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface SetlistCoverage {
  artist_count: number;
  fresh: number;
  stale: number;
  missing: number;
  unknown: number;
  queued?: number | null;
}

type ViewMode = "list" | "calendar";
const SHOWS_PAGE_SIZE = 20;
const NOT_LISTED_TEXT = "That show isn't in the upcoming list.";

/** The DOM id a linked show scrolls to. */
function showAnchorId(showId: number): string {
  return `upcoming-show-${showId}`;
}

/**
 * The list key, also used to expand an item. A show is keyed by its ID, so
 * exact twins (two saved shows with the same details) stay apart.
 */
function itemKey(item: UpcomingItem): string {
  return item.show_id != null
    ? `show-${item.show_id}`
    : `show-${item.artist}-${item.venue ?? item.title}-${item.date}`;
}

export function Upcoming() {
  const { hasCapability } = useAuth();
  const canCurateShows = hasCapability("curation.shows.write");
  const canRefreshSetlists = hasCapability("library.metadata.write");
  const [items, setItems] = useState<UpcomingItem[]>([]);
  const [setlistCoverage, setSetlistCoverage] = useState<SetlistCoverage>({
    artist_count: 0,
    fresh: 0,
    stale: 0,
    missing: 0,
    unknown: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const readGeneration = useRef(0);
  const syncWait = useRef<AbortController | null>(null);
  const [genreFilter, setGenreFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<ViewMode>("list");
  const [syncing, setSyncing] = useState(false);
  const [refreshingSetlists, setRefreshingSetlists] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [calMonth, setCalMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  // `?show_id=` opens that show's detail, e.g. from «Open show» after a save.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedShowId = searchParams.get("show_id");
  const [linkNotice, setLinkNotice] = useState("");
  const [scrollTo, setScrollTo] = useState<number | null>(null);
  // A new array per «Merge duplicates» in a show's detail, so the merge
  // panel loads that show and its look-alikes.
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeIds, setMergeIds] = useState<readonly number[] | null>(null);

  async function fetchItems() {
    const request = ++readGeneration.current;
    setLoadError(false);
    setLoading(!hasLoaded);
    try {
      const data = await api<{
        events: CachedShowEvent[];
        setlist_coverage?: SetlistCoverage;
      }>("/api/shows/cached?limit=5000");
      if (request !== readGeneration.current) return;
      setItems((data.events || []).map(upcomingItemFromCachedShow));
      setSetlistCoverage(
        data.setlist_coverage || {
          artist_count: 0,
          fresh: 0,
          stale: 0,
          missing: 0,
          unknown: 0,
        },
      );
      setHasLoaded(true);
    } catch {
      if (request === readGeneration.current) setLoadError(true);
    } finally {
      if (request === readGeneration.current) setLoading(false);
    }
  }

  useEffect(() => {
    void fetchItems();
    return () => {
      readGeneration.current += 1;
      syncWait.current?.abort();
    };
  }, []);

  const availableGenres = useMemo(() => {
    return buildUpcomingGenreOptions(items, { type: "shows", search });
  }, [items, search]);

  const availableCities = useMemo(() => {
    return buildUpcomingCityOptions(items, { type: "shows" });
  }, [items]);

  // Reset genre/city filter if the selected value is no longer available
  useEffect(() => {
    if (genreFilter && !availableGenres.some(([g]) => g === genreFilter)) {
      setGenreFilter("");
      setPage(1);
    }
  }, [genreFilter, availableGenres]);
  useEffect(() => {
    if (cityFilter && !availableCities.some(([c]) => c === cityFilter)) {
      setCityFilter("");
      setPage(1);
    }
  }, [cityFilter, availableCities]);

  const filtered = useMemo(() => {
    return filterUpcomingItems(items, {
      type: "shows",
      search,
      genre: genreFilter,
      city: cityFilter,
    });
  }, [items, search, genreFilter, cityFilter]);

  const openLinkedShow = useEffectEvent((raw: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete("show_id");
    setSearchParams(next, { replace: true });
    const showId = /^\d+$/.test(raw) ? Number(raw) : NaN;
    const item = items.find(
      (candidate) => candidate.type === "show" && candidate.show_id === showId,
    );
    if (!item) {
      setLinkNotice(NOT_LISTED_TEXT);
      return;
    }
    setLinkNotice("");
    const isInCurrentResults =
      filterUpcomingItems([item], {
        type: "shows",
        search,
        genre: genreFilter,
        city: cityFilter,
      }).length > 0;
    const targetItems = isInCurrentResults
      ? filtered
      : filterUpcomingItems(items, {
          type: "shows",
          search: "",
          genre: "",
          city: "",
        });
    const targetIndex = targetItems.findIndex(
      (candidate) => itemKey(candidate) === itemKey(item),
    );
    if (!isInCurrentResults) {
      setSearch("");
      setGenreFilter("");
      setCityFilter("");
    }
    if (targetIndex >= 0)
      setPage(Math.floor(targetIndex / SHOWS_PAGE_SIZE) + 1);
    setView("list");
    setExpandedId(itemKey(item));
    setScrollTo(showId);
  });
  useEffect(() => {
    if (!loading && linkedShowId) openLinkedShow(linkedShowId);
  }, [loading, linkedShowId]);
  useEffect(() => {
    if (scrollTo === null) return;
    const anchor = document.getElementById(showAnchorId(scrollTo));
    if (!anchor) return;
    anchor.scrollIntoView?.({ block: "center", behavior: "smooth" });
    setScrollTo(null);
  }, [scrollTo, page]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / SHOWS_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const upcoming = filtered.slice(
    (currentPage - 1) * SHOWS_PAGE_SIZE,
    currentPage * SHOWS_PAGE_SIZE,
  );

  async function syncShows() {
    const controller = new AbortController();
    syncWait.current = controller;
    setSyncing(true);
    try {
      const { task_id } = await api<{ task_id: string }>(
        "/api/tasks/sync-shows",
        "POST",
      );
      if (!task_id) throw new Error("Show sync returned no task identifier");
      toast.success("Show sync queued");
      const task = await waitForTask(task_id, 300000, controller.signal);
      if (task.status !== "completed")
        throw new Error(task.error || `Show sync ${task.status}`);
      toast.success("Show sync completed");
      await fetchItems();
    } catch (error) {
      if (!controller.signal.aborted)
        toast.error(
          error instanceof Error ? error.message : "Failed to sync shows",
        );
    } finally {
      if (!controller.signal.aborted) setSyncing(false);
    }
  }

  async function refreshStaleSetlists() {
    setRefreshingSetlists(true);
    try {
      const result = await api<SetlistCoverage>(
        "/api/shows/probable-setlists/refresh",
        "POST",
      );
      setSetlistCoverage(result);
      if ((result.queued || 0) > 0) {
        toast.success(`Queued ${result.queued} probable setlist refreshes`);
      } else {
        toast.success("All probable setlists are up to date");
      }
    } catch {
      toast.error("Could not refresh probable setlists");
    } finally {
      setRefreshingSetlists(false);
    }
  }

  const showCount = items.filter((i) => i.type === "show").length;
  const showActions = canCurateShows
    ? (item: UpcomingItem) =>
        item.show_id ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Merge duplicates of this show"
            onClick={() => {
              setMergeIds(sameShowIds(items, item));
              setMergeOpen(true);
            }}
          >
            Merge duplicates
          </Button>
        ) : null
    : undefined;

  return (
    <div className="min-w-0 space-y-6">
      <OpsPageHero
        title="Show Management"
        description="Keep the live calendar clean and check that every billed artist has a recent probable setlist."
        compactActions
        actions={
          <PageHeaderActions label="Show management actions">
            <AddShowButton onSaved={() => void fetchItems()} />
            <MergeShowsButton onMerged={() => void fetchItems()} />
            {canCurateShows ? (
              <PageHeaderAction
                label="Sync shows"
                onClick={syncShows}
                disabled={syncing}
                aria-busy={syncing}
              >
                {syncing ? (
                  <Loader2
                    data-admin-ux="upcoming-sync"
                    aria-hidden="true"
                    size={14}
                    className="animate-spin"
                  />
                ) : null}
                {!syncing ? (
                  <HeaderCalendarSync
                    data-admin-ux="header-sync-shows"
                    aria-hidden="true"
                  />
                ) : null}
              </PageHeaderAction>
            ) : null}
            {canRefreshSetlists ? (
              <PageHeaderAction
                label={
                  refreshingSetlists
                    ? "Refreshing setlists…"
                    : "Refresh setlists"
                }
                onClick={refreshStaleSetlists}
                disabled={
                  refreshingSetlists ||
                  setlistCoverage.stale +
                    setlistCoverage.missing +
                    setlistCoverage.unknown ===
                    0
                }
                aria-busy={refreshingSetlists}
              >
                {refreshingSetlists ? (
                  <Loader2
                    data-admin-ux="upcoming-refresh-setlists-loading"
                    aria-hidden="true"
                    size={14}
                    className="animate-spin"
                  />
                ) : (
                  <HeaderCalendarSync
                    data-admin-ux="upcoming-refresh-setlists"
                    aria-hidden="true"
                  />
                )}
              </PageHeaderAction>
            ) : null}
            <PageHeaderAction
              label="List view"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              <HeaderList
                data-admin-ux="upcoming-view-list"
                aria-hidden="true"
              />
            </PageHeaderAction>
            <PageHeaderAction
              label="Calendar view"
              aria-pressed={view === "calendar"}
              onClick={() => setView("calendar")}
            >
              <Calendar
                data-admin-ux="upcoming-view-calendar"
                aria-hidden="true"
              />
            </PageHeaderAction>
          </PageHeaderActions>
        }
      >
        {hasLoaded ? (
          <>
            <InfoBadge active>{showCount} shows</InfoBadge>
            <InfoBadge>{setlistCoverage.artist_count} billed artists</InfoBadge>
            <InfoBadge
              tone="success"
              title="Generated within the freshness window: 7 days, or 24 hours during an active tour."
            >
              {setlistCoverage.fresh} recent
            </InfoBadge>
            {setlistCoverage.stale > 0 ? (
              <InfoBadge tone="warning">
                {setlistCoverage.stale} outdated
              </InfoBadge>
            ) : null}
            {setlistCoverage.missing > 0 ? (
              <InfoBadge tone="neutral">
                {setlistCoverage.missing} missing
              </InfoBadge>
            ) : null}
            {setlistCoverage.unknown > 0 ? (
              <InfoBadge tone="info">
                {setlistCoverage.unknown} without date
              </InfoBadge>
            ) : null}
            {setlistCoverage.queued != null ? (
              <InfoBadge tone="info">
                {setlistCoverage.queued} refreshes queued
              </InfoBadge>
            ) : null}
          </>
        ) : (
          <InfoBadge>
            {loading ? "Loading shows" : "Show data unavailable"}
          </InfoBadge>
        )}
      </OpsPageHero>

      {loadError ? (
        <ErrorState
          title="Shows unavailable"
          message={
            hasLoaded
              ? "The latest shows could not be loaded. The last successful calendar remains visible."
              : "The show calendar could not be loaded. Try again."
          }
          onRetry={() => void fetchItems()}
        />
      ) : null}

      <OpsSurface className="p-3">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1 basis-60">
            <label
              htmlFor="upcoming-artist"
              className="crate-form-field min-w-0"
            >
              <MonoLabel as="span">Artist</MonoLabel>
              <SearchInput
                id="upcoming-artist"
                label="Artist"
                placeholder="Filter by artist..."
                value={search}
                onValueChange={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
              />
            </label>
          </div>

          {availableGenres.length > 0 && (
            <div className="crate-form-field">
              <MonoLabel as="span" data-slot="form-field-label">
                Genre
              </MonoLabel>
              <AdminSelect
                value={genreFilter}
                onChange={(value) => {
                  setGenreFilter(value);
                  setPage(1);
                }}
                options={availableGenres.map(([name, count]) => ({
                  value: name,
                  label: name,
                  count,
                }))}
                placeholder="All genres"
                searchable
                searchPlaceholder="Search genres..."
              />
            </div>
          )}

          {availableCities.length > 0 && (
            <div className="crate-form-field">
              <MonoLabel as="span" data-slot="form-field-label">
                City
              </MonoLabel>
              <AdminSelect
                value={cityFilter}
                onChange={(value) => {
                  setCityFilter(value);
                  setPage(1);
                }}
                options={availableCities.map(([name, count]) => ({
                  value: name,
                  label: name,
                  count,
                }))}
                placeholder="All cities"
                searchable
                searchPlaceholder="Search cities..."
              />
            </div>
          )}
        </div>

        {/* Always mounted, so a screen reader hears the notice arrive. */}
        <div className={cn("flex items-center gap-2", linkNotice && "mt-3")}>
          <p
            role="status"
            aria-label="Show link status"
            className="text-sm text-text-muted empty:sr-only"
          >
            {linkNotice}
          </p>
          {linkNotice ? (
            <ActionIconButton
              onClick={() => setLinkNotice("")}
              title="Dismiss"
              aria-label="Dismiss"
            >
              <X data-admin-ux="upcoming-dismiss-notice" size={14} />
            </ActionIconButton>
          ) : null}
        </div>
      </OpsSurface>

      {loading && (
        <div
          role="status"
          aria-label="Loading shows"
          className="flex items-center justify-center py-24"
        >
          <Loader2
            data-admin-ux="upcoming-loading"
            aria-hidden="true"
            className="h-6 w-6 animate-spin text-accent-action-hi"
          />
        </div>
      )}

      {!loading && !loadError && items.length === 0 && (
        <OpsSurface role="status" className="px-6 py-24 text-center">
          <h2 className="font-display text-lg font-semibold text-text-primary">
            No upcoming shows
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            Add a show manually or sync the artists’ upcoming dates.
          </p>
        </OpsSurface>
      )}

      {!loading && items.length > 0 && filtered.length === 0 ? (
        <OpsSurface role="status" className="px-6 py-16 text-center">
          <h2 className="font-display text-lg font-semibold text-text-primary">
            No shows match these filters
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            Clear the artist, genre, or city filters to see the full calendar.
          </p>
        </OpsSurface>
      ) : null}

      {/* List View */}
      {!loading && view === "list" && (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <section>
              <MonoLabel as="h2" tone="accent" className="mb-4">
                Show calendar
              </MonoLabel>
              {groupByMonth(upcoming).map(([month, monthItems]) => (
                <MonthGroup
                  key={month}
                  month={month}
                  items={monthItems}
                  expandedId={expandedId}
                  onToggleExpand={setExpandedId}
                  showActions={showActions}
                />
              ))}
              <ListPagination
                label="shows"
                itemCount={filtered.length}
                page={currentPage}
                pageSize={SHOWS_PAGE_SIZE}
                onPageChange={setPage}
              />
            </section>
          )}
        </div>
      )}

      {/* Calendar View */}
      {!loading && view === "calendar" && (
        <CalendarView
          items={filtered}
          month={calMonth}
          onMonthChange={(dir) =>
            setCalMonth((m) => new Date(m.getFullYear(), m.getMonth() + dir, 1))
          }
          onShowClick={(item) => {
            const itemIndex = filtered.findIndex(
              (candidate) => itemKey(candidate) === itemKey(item),
            );
            if (itemIndex >= 0)
              setPage(Math.floor(itemIndex / SHOWS_PAGE_SIZE) + 1);
            setView("list");
            setExpandedId(itemKey(item));
          }}
        />
      )}

      {canCurateShows ? (
        <MergeShowsSheet
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          onMerged={() => void fetchItems()}
          initialIds={mergeIds}
        />
      ) : null}
    </div>
  );
}

// ── Month group for list view ──

function MonthGroup({
  month,
  items,
  expandedId,
  onToggleExpand,
  showActions,
}: {
  month: string;
  items: UpcomingItem[];
  expandedId: string | null;
  onToggleExpand: (id: string | null) => void;
  showActions?: (item: UpcomingItem) => ReactNode;
}) {
  const label =
    month === "Unknown"
      ? "Unknown Date"
      : new Date(month + "-15").toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        });

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-2 border-b border-border-quiet pb-2">
        <MonoLabel as="div" size="eyebrow">
          {label}
        </MonoLabel>
        <InfoBadge>{items.length} shows</InfoBadge>
      </div>
      <div className="space-y-2">
        {items.map((item) => {
          const key = itemKey(item);
          const isExpanded = expandedId === key;
          return (
            <div
              key={key}
              id={item.show_id ? showAnchorId(item.show_id) : undefined}
            >
              <ShowManagementRow
                item={item}
                expanded={isExpanded}
                onToggle={() => onToggleExpand(isExpanded ? null : key)}
                actions={isExpanded ? showActions?.(item) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Calendar View ──

function CalendarView({
  items,
  month,
  onMonthChange,
  onShowClick,
}: {
  items: UpcomingItem[];
  month: Date;
  onMonthChange: (dir: number) => void;
  onShowClick: (item: UpcomingItem) => void;
}) {
  const year = month.getFullYear();
  const m = month.getMonth();
  const firstDay = new Date(year, m, 1).getDay();
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  const startOffset = (firstDay + 6) % 7; // Monday=0

  const now = new Date();
  const todayDay =
    now.getFullYear() === year && now.getMonth() === m ? now.getDate() : -1;

  // Group items by day
  const byDay = useMemo(() => {
    const map = new Map<number, UpcomingItem[]>();
    for (const item of items) {
      if (!item.date) continue;
      const d = new Date(item.date + "T12:00:00");
      if (d.getFullYear() === year && d.getMonth() === m) {
        const day = d.getDate();
        const existing = map.get(day) || [];
        existing.push(item);
        map.set(day, existing);
      }
    }
    return map;
  }, [items, year, m]);

  return (
    <OpsSurface className="p-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <ActionButton label="Previous month" onClick={() => onMonthChange(-1)}>
          <ChevronLeft
            data-admin-ux="upcoming-previous"
            aria-hidden="true"
            size={16}
          />
        </ActionButton>
        <MonoLabel as="h2" tone="accent" className="text-center">
          {month.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}
        </MonoLabel>
        <ActionButton label="Next month" onClick={() => onMonthChange(1)}>
          <ChevronRight
            data-admin-ux="upcoming-next"
            aria-hidden="true"
            size={16}
          />
        </ActionButton>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[630px]">
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-px mb-1">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <MonoLabel
                key={d}
                as="div"
                size="eyebrow"
                className="py-1 text-center"
              >
                {d}
              </MonoLabel>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-px">
            {Array.from(
              { length: startOffset },
              (_, slot) => `empty-${slot}`,
            ).map((key) => (
              <div
                key={key}
                className="min-h-[92px] rounded-md border border-border-quiet bg-surface-canvas"
              />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const dayItems = byDay.get(day) || [];
              const isToday = day === todayDay;
              return (
                <div
                  key={day}
                  className={cn(
                    "min-h-[92px] rounded-md border border-border-quiet bg-surface-canvas p-2",
                    isToday
                      ? "border-accent-action-hi bg-accent-action/10"
                      : dayItems.length > 0 && "border-accent-action-hi/30",
                  )}
                >
                  <div
                    className={cn(
                      "mb-1 font-mono font-normal text-[10px]",
                      isToday ? "text-accent-action-hi" : "text-text-muted",
                    )}
                  >
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {dayItems.slice(0, 3).map((item) => (
                      <CalendarPill
                        key={itemKey(item)}
                        item={item}
                        onShowClick={() => onShowClick(item)}
                      />
                    ))}
                    {dayItems.length > 3 && (
                      <div className="text-[9px] text-muted-foreground/40">
                        +{dayItems.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </OpsSurface>
  );
}

// ── Calendar Pill with Popover ──

function CalendarPill({
  item,
  onShowClick,
}: {
  item: UpcomingItem;
  onShowClick: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "min-h-11 w-full truncate rounded-md px-2 py-1 text-left text-[10px] transition-colors",
            "bg-accent-action/15 text-accent-action-hi hover:bg-accent-action/25",
          )}
        >
          {item.artist}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[340px] max-w-[calc(100vw-2rem)] p-0"
        align="start"
      >
        <div>
          <div className="p-3">
            <ShowCard show={item} className="w-full" />
          </div>
          <div className="px-3 pb-3">
            <button
              onClick={onShowClick}
              className="min-h-11 w-full rounded-md bg-accent-action/5 py-1.5 text-center text-xs text-accent-action-hi transition-colors hover:bg-accent-action/10"
            >
              View full details
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
