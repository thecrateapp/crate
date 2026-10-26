import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import {
  useState,
  useEffect,
  useCallback,
  useEffectEvent,
  useRef,
} from "react";
import { useSearchParams } from "react-router";
import {
  AdminSelect,
  type AdminSelectOption,
} from "@/components/ui/AdminSelect";
import { Button } from "@crate/ui/shadcn/button";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import {
  LayoutGrid,
  ListOrdered as List,
  X,
  RefreshCw,
  AudioLines,
  Trash2,
  Check,
  Loader2,
} from "@crate/ui/icons";
import { Skeleton } from "@crate/ui/shadcn/skeleton";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { api } from "@/lib/api";
import {
  OpsPageHero,
  OpsPanel,
  OpsRefreshNotice,
  OpsSurface,
} from "@/components/admin/ops-surfaces";
import {
  artistActionApiPath,
  artistManagementApiPath,
} from "@/lib/library-routes";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { ArtistCard } from "@/components/artist/ArtistCard";
import { ArtistRow } from "@/components/artist/ArtistRow";

interface ArtistItem {
  id?: number;
  entity_uid?: string;
  slug?: string;
  name: string;
  albums: number;
  tracks: number;
  total_size_mb: number;
  has_photo: boolean;
  primary_format?: string;
  listeners?: number;
  genres?: string[];
  has_issues?: boolean;
  is_featured?: boolean;
  featured_devices?: string[];
}

interface PaginatedResponse {
  items: ArtistItem[];
  total: number;
  page: number;
  per_page: number;
}

interface FilterOption {
  name: string;
  count?: number;
  cnt?: number;
}

interface BrowseFilters {
  genres: FilterOption[];
  countries: FilterOption[];
  decades: string[];
  formats: FilterOption[];
}

const PER_PAGE = 60;

const SORT_OPTIONS = [
  { value: "name", label: "Name" },
  { value: "popularity", label: "Popularity" },
  { value: "albums", label: "Albums" },
  { value: "recent", label: "Recently Added" },
  { value: "size", label: "Size" },
];

const FEATURED_OPTIONS = [
  { value: "true", label: "Featured artists" },
  { value: "false", label: "Not featured" },
];

const ISSUE_OPTIONS = [
  { value: "true", label: "With open issues" },
  { value: "false", label: "No open issues" },
];

export function Browse() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasCapability } = useAuth();
  const canEnrich = hasCapability("library.metadata.write");
  const canAnalyze = hasCapability("library.analysis.manage");
  const canDelete =
    hasCapability("library.artist.remove") &&
    hasCapability("library.files.delete");
  const canSelect = canEnrich || canAnalyze || canDelete;
  const requestGeneration = useRef(0);
  const [batchPending, setBatchPending] = useState<
    "enrich" | "reanalyze" | "delete" | null
  >(null);
  const batchPendingRef = useRef(false);

  const genre = searchParams.get("genre") ?? "";
  const country = searchParams.get("country") ?? "";
  const decade = searchParams.get("decade") ?? "";
  const format = searchParams.get("format") ?? "";
  const sort = searchParams.get("sort") ?? "recent";
  const featured = searchParams.get("featured") ?? "";
  const hasIssues = searchParams.get("has_issues") ?? "";
  const view = (searchParams.get("view") ?? "grid") as "grid" | "list";
  const [filters, setFilters] = useState<BrowseFilters | null>(null);
  const [artists, setArtists] = useState<ArtistItem[]>([]);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<number | null>(null);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showBatchDelete, setShowBatchDelete] = useState(false);

  function toggleSelect(artistId?: number) {
    if (artistId == null) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(artistId)) next.delete(artistId);
      else next.add(artistId);
      return next;
    });
  }

  function selectAll() {
    setSelected(
      new Set(
        artists.map((a) => a.id).filter((id): id is number => id != null),
      ),
    );
  }

  function clearSelection() {
    setSelected(new Set<number>());
    setSelectMode(false);
  }

  async function batchAction(action: "enrich" | "reanalyze") {
    if (
      batchPendingRef.current ||
      !(action === "enrich" ? canEnrich : canAnalyze)
    )
      return;
    batchPendingRef.current = true;
    setBatchPending(action);
    const artistsById = new Map(
      artists.flatMap((artist) =>
        artist.id == null ? [] : [[artist.id, artist] as const],
      ),
    );
    try {
      const outcomes = await Promise.all(
        Array.from(selected, async (artistId) => {
          const artist = artistsById.get(artistId);
          const reference = { artistId, artistEntityUid: artist?.entity_uid };
          const endpoint =
            action === "enrich"
              ? artistActionApiPath(reference, "enrich")
              : artistManagementApiPath(reference, "reanalyze");
          try {
            if (!endpoint) throw new Error("Artist reference missing");
            await api(endpoint, "POST");
            return { artistId, queued: true };
          } catch {
            return { artistId, queued: false };
          }
        }),
      );
      const failed = outcomes.filter((outcome) => !outcome.queued);
      const queued = outcomes.length - failed.length;
      const label = action === "enrich" ? "Enrichment" : "Analysis";
      if (queued)
        toast.success(
          `${label} started for ${queued} artist${queued === 1 ? "" : "s"}`,
        );
      if (failed.length) {
        toast.error(
          `${label} failed for ${failed.length} artist${failed.length === 1 ? "" : "s"}`,
          { description: "Failed artists remain selected. Try again." },
        );
        setSelected(new Set(failed.map((outcome) => outcome.artistId)));
      } else clearSelection();
    } finally {
      batchPendingRef.current = false;
      setBatchPending(null);
    }
  }

  async function batchDelete() {
    if (batchPendingRef.current || !canDelete) return;
    batchPendingRef.current = true;
    setBatchPending("delete");
    let queued = 0;
    let failed = 0;

    const artistsById = new Map(
      artists.flatMap((artist) =>
        artist.id == null ? [] : [[artist.id, artist] as const],
      ),
    );
    const outcomes = await Promise.all(
      Array.from(selected, async (artistId) => {
        const artist = artistsById.get(artistId);
        const endpoint = artistManagementApiPath(
          { artistId, artistEntityUid: artist?.entity_uid },
          "delete",
        );
        if (!endpoint) return "failed" as const;
        try {
          await api<{ task_id: string }>(endpoint, "POST", { mode: "full" });
          return "queued" as const;
        } catch {
          return "failed" as const;
        }
      }),
    );
    queued = outcomes.filter((outcome) => outcome === "queued").length;
    failed = outcomes.length - queued;

    if (queued > 0) {
      toast.success(
        `Queued deletion for ${queued} artist${queued === 1 ? "" : "s"}`,
        {
          description:
            failed > 0
              ? `${failed} request${
                  failed === 1 ? "" : "s"
                } failed. Check Tasks for progress.`
              : "The worker will delete them in the background. Check Tasks for progress.",
        },
      );
    } else {
      toast.error("Failed to queue artist deletion");
    }

    batchPendingRef.current = false;
    setBatchPending(null);
    if (failed) {
      setSelected(
        new Set(
          Array.from(selected).filter(
            (_, index) => outcomes[index] !== "queued",
          ),
        ),
      );
      throw new Error(
        "Some artists could not be queued. Failed artists remain selected.",
      );
    }
    clearSelection();
  }

  const setParam = useCallback(
    (key: string, value: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== "page") next.delete("page");
        return next;
      });
    },
    [setSearchParams],
  );

  const setView = (v: "grid" | "list") =>
    setParam("view", v === "grid" ? "" : v);

  useEffect(() => {
    const params = new URLSearchParams();
    if (country) params.set("country", country);
    if (decade) params.set("decade", decade);
    if (format) params.set("format", format);
    const query = params.toString();

    let cancelled = false;
    api<BrowseFilters>(`/api/browse/filters${query ? `?${query}` : ""}`)
      .then((data) => {
        if (cancelled) return;
        setFilters(data);
        if (genre && !data.genres.some((option) => option.name === genre)) {
          setParam("genre", "");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [country, decade, format, genre, setParam]);

  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(
    (page: number, reset = false) => {
      const generation = reset
        ? ++requestGeneration.current
        : requestGeneration.current;
      setPageError(null);
      if (reset) setLoading(true);
      else setLoadingMore(true);
      const params = new URLSearchParams();
      if (genre) params.set("genre", genre);
      if (country) params.set("country", country);
      if (decade) params.set("decade", decade);
      if (format) params.set("format", format);
      if (featured) params.set("featured", featured);
      if (hasIssues) params.set("has_issues", hasIssues);
      params.set("sort", sort);
      params.set("page", String(page));
      params.set("per_page", String(PER_PAGE));
      params.set("view", view);

      api<PaginatedResponse>(`/api/artists?${params.toString()}`)
        .then((data) => {
          if (generation !== requestGeneration.current) return;
          setArtists((prev) => (reset ? data.items : [...prev, ...data.items]));
          setTotal(data.total);
          hasMoreRef.current = data.items.length >= PER_PAGE;
        })
        .catch(() => {
          if (generation !== requestGeneration.current) return;
          setPageError(page);
          if (reset) {
            setArtists([]);
            setTotal(0);
          }
          hasMoreRef.current = false;
        })
        .finally(() => {
          if (generation !== requestGeneration.current) return;
          setLoading(false);
          setLoadingMore(false);
        });
    },
    [genre, country, decade, format, sort, featured, hasIssues, view],
  );

  const fetchPageEvent = useEffectEvent(fetchPage);

  // Reset and fetch page 1 when filters change.
  useEffect(() => {
    pageRef.current = 1;
    hasMoreRef.current = true;
    setArtists([]);
    fetchPageEvent(1, true);
  }, [genre, country, decade, format, sort, featured, hasIssues, view]);

  // Infinite scroll: observe sentinel element
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          !loading &&
          !loadingMore &&
          hasMoreRef.current
        ) {
          pageRef.current += 1;
          fetchPageEvent(pageRef.current);
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, loadingMore]);

  const genreOptions: AdminSelectOption[] = (filters?.genres ?? []).map(
    (option) => ({
      value: option.name,
      label: option.name,
      count: option.count ?? option.cnt ?? 0,
    }),
  );

  const countryOptions: AdminSelectOption[] = (filters?.countries ?? []).map(
    (option) => ({
      value: option.name,
      label: option.name,
      count: option.count ?? option.cnt ?? 0,
    }),
  );

  const decadeOptions: AdminSelectOption[] = (filters?.decades ?? []).map(
    (decadeValue) => ({
      value: decadeValue,
      label: decadeValue,
    }),
  );

  const formatOptions: AdminSelectOption[] = (filters?.formats ?? []).map(
    (option) => ({
      value: option.name,
      label: option.name,
      count: option.count ?? option.cnt ?? 0,
    }),
  );

  const sortOptions: AdminSelectOption[] = SORT_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));

  const hasActiveFilters = Boolean(
    genre || country || decade || format || featured || hasIssues,
  );

  function clearFilters() {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      [
        "genre",
        "country",
        "decade",
        "format",
        "featured",
        "has_issues",
        "page",
      ].forEach((key) => next.delete(key));
      return next;
    });
  }

  function retryFailedPage() {
    const page = pageError ?? 1;
    hasMoreRef.current = true;
    fetchPage(page, page === 1);
  }

  return (
    <div className={selected.size ? "space-y-6 pb-36 sm:pb-24" : "space-y-6"}>
      <OpsPageHero
        title="Browse Artists"
        description="Explore the artists in your library and narrow the catalog with the filters below."
      >
        <InfoBadge>
          {loading ? "Loading artists" : `${total.toLocaleString()} artists`}
        </InfoBadge>
      </OpsPageHero>

      <OpsPanel
        title="Artist catalog"
        description="Filter by sound, origin, format or library status. Your selection stays in the URL."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {canSelect ? (
              <Button
                size="sm"
                disabled={batchPending !== null}
                variant={selectMode ? "default" : "outline"}
                onClick={() => {
                  setSelectMode(!selectMode);
                  if (selectMode) clearSelection();
                }}
              >
                {selectMode ? "Done" : "Select"}
              </Button>
            ) : null}
            <ActionGroup label="Artist view">
              <ActionButton
                label="Grid view"
                aria-pressed={view === "grid"}
                onClick={() => setView("grid")}
              >
                <LayoutGrid data-admin-ux="browse-grid" aria-hidden="true" />
              </ActionButton>
              <ActionButton
                label="List view"
                aria-pressed={view === "list"}
                onClick={() => setView("list")}
              >
                <List data-admin-ux="browse-list" aria-hidden="true" />
              </ActionButton>
            </ActionGroup>
          </div>
        }
      >
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <AdminSelect
            placeholder="All genres"
            value={genre}
            onChange={(nextValue) => setParam("genre", nextValue)}
            options={genreOptions}
            searchable
            searchPlaceholder="Search genres..."
          />
          <AdminSelect
            placeholder="All countries"
            value={country}
            onChange={(nextValue) => setParam("country", nextValue)}
            options={countryOptions}
            searchable
            searchPlaceholder="Search countries..."
          />
          <AdminSelect
            placeholder="All decades"
            value={decade}
            onChange={(nextValue) => setParam("decade", nextValue)}
            options={decadeOptions}
          />
          <AdminSelect
            placeholder="All formats"
            value={format}
            onChange={(nextValue) => setParam("format", nextValue)}
            options={formatOptions}
            searchable
            searchPlaceholder="Search formats..."
          />
        </div>

        <div className="mt-4 grid gap-4 border-t border-border-quiet pt-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="crate-form-field max-w-full">
            <MonoLabel as="span" className="block">
              Featured
            </MonoLabel>
            <SegmentedControl
              as="radio"
              label="Featured"
              value={featured}
              onValueChange={(nextValue) => setParam("featured", nextValue)}
              items={[{ value: "", label: "Featured" }, ...FEATURED_OPTIONS]}
            />
          </div>

          <div className="crate-form-field max-w-full">
            <MonoLabel as="span" className="block">
              Issues
            </MonoLabel>
            <SegmentedControl
              as="radio"
              label="Issues"
              value={hasIssues}
              onValueChange={(nextValue) => setParam("has_issues", nextValue)}
              items={[{ value: "", label: "Issues" }, ...ISSUE_OPTIONS]}
            />
          </div>

          <div className="crate-form-field max-w-full">
            <MonoLabel as="span" className="block">
              Sort artists
            </MonoLabel>
            <SegmentedControl
              as="radio"
              label="Sort artists"
              value={sort}
              onValueChange={(nextValue) =>
                setParam("sort", nextValue || "recent")
              }
              items={sortOptions}
            />
          </div>
        </div>

        {/* Results count */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span aria-live="polite">
              {loading
                ? "Loading artists..."
                : `Showing ${artists.length.toLocaleString()} of ${total.toLocaleString()} artists`}
            </span>
            {hasActiveFilters ? <InfoBadge>Filtered</InfoBadge> : null}
          </div>
          {hasActiveFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>

        {pageError !== null ? (
          <OpsRefreshNotice
            message={
              pageError === 1
                ? "Could not load artists. Try again."
                : "Some artists could not be loaded. Your current results are still available."
            }
            onRetry={retryFailedPage}
            retrying={loading || loadingMore}
          />
        ) : null}

        {/* Content */}
        {loading ? (
          view === "grid" ? (
            <GridSkeletonBlock />
          ) : (
            <ListSkeletonBlock />
          )
        ) : artists.length === 0 ? (
          pageError === null ? (
            <OpsSurface className="px-5 py-12 text-center">
              <h3 className="font-display text-lg font-semibold text-text-primary">
                {hasActiveFilters
                  ? "No artists match these filters"
                  : "No artists in the library yet"}
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm text-text-muted">
                {hasActiveFilters
                  ? "Try removing a filter or choose a broader set of artists."
                  : "Artists will appear here as the library is indexed."}
              </p>
              {hasActiveFilters ? (
                <Button
                  className="mt-4"
                  variant="outline"
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              ) : null}
            </OpsSurface>
          ) : null
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {artists.map((a) => (
              <ArtistCard
                key={a.name}
                artworkShape="square"
                artistId={a.id}
                artistSlug={a.slug}
                name={a.name}
                albums={a.albums}
                tracks={a.tracks}
                size_mb={a.total_size_mb}
                primary_format={a.primary_format ?? ""}
                hasIssues={a.has_issues}
                isFeatured={a.is_featured}
                featuredDevices={a.featured_devices}
                selectMode={selectMode}
                isSelected={a.id != null ? selected.has(a.id) : false}
                onClick={selectMode ? () => toggleSelect(a.id) : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {artists.map((a) => (
              <ArtistRow
                key={a.name}
                artworkShape="square"
                name={a.name}
                artistId={a.id}
                artistSlug={a.slug}
                albums={a.albums}
                tracks={a.tracks}
                total_size_mb={a.total_size_mb}
                listeners={a.listeners}
                genres={a.genres}
                hasIssues={a.has_issues}
                isFeatured={a.is_featured}
                featuredDevices={a.featured_devices}
                selectMode={selectMode}
                isSelected={a.id != null ? selected.has(a.id) : false}
                onClick={selectMode ? () => toggleSelect(a.id) : undefined}
              />
            ))}
          </div>
        )}
      </OpsPanel>

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-10 flex items-center justify-center">
        {loadingMore && (
          <Loader2 className="h-5 w-5 animate-spin text-accent-action-hi" />
        )}
        {!hasMoreRef.current && artists.length > 0 && (
          <span className="text-xs text-muted-foreground">{total} artists</span>
        )}
      </div>

      {canSelect && selected.size > 0 && (
        <div
          data-slot="browse-batch-actions"
          className="fixed inset-x-0 bottom-0 z-40 flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-canvas px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:left-[var(--sidebar-w)]"
        >
          <MonoLabel as="span" aria-live="polite">
            {selected.size} selected
          </MonoLabel>
          <ActionGroup label="Selected artist actions">
            {canEnrich ? (
              <ActionButton
                label="Enrich selected artists"
                disabled={batchPending !== null}
                loading={batchPending === "enrich"}
                onClick={() => void batchAction("enrich")}
              >
                <RefreshCw
                  data-admin-ux="browse-batch-enrich"
                  aria-hidden="true"
                />
              </ActionButton>
            ) : null}
            {canAnalyze ? (
              <ActionButton
                label="Analyze selected artists"
                disabled={batchPending !== null}
                loading={batchPending === "reanalyze"}
                onClick={() => void batchAction("reanalyze")}
              >
                <AudioLines
                  data-admin-ux="browse-batch-analyze"
                  aria-hidden="true"
                />
              </ActionButton>
            ) : null}
            {canDelete ? (
              <ActionButton
                label="Delete selected artists"
                disabled={batchPending !== null}
                onClick={() => setShowBatchDelete(true)}
              >
                <Trash2
                  data-admin-ux="browse-batch-delete"
                  aria-hidden="true"
                />
              </ActionButton>
            ) : null}
            <ActionButton
              label="Select all loaded artists"
              disabled={batchPending !== null}
              onClick={selectAll}
            >
              <Check
                data-admin-ux="browse-batch-select-all"
                aria-hidden="true"
              />
            </ActionButton>
            <ActionButton
              label="Cancel selection"
              disabled={batchPending !== null}
              onClick={clearSelection}
            >
              <X data-admin-ux="browse-batch-cancel" aria-hidden="true" />
            </ActionButton>
          </ActionGroup>
        </div>
      )}

      <ConfirmDialog
        open={showBatchDelete}
        onOpenChange={setShowBatchDelete}
        title="Delete artists"
        description={`This will permanently delete ${selected.size} artist(s) and all their files. This action cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={batchDelete}
        onError={() => {}}
        eyebrow="Confirm action"
        consequence={`${selected.size} artists · permanently deletes all their files`}
      />
    </div>
  );
}

function GridSkeletonBlock() {
  const skeletonKeys = Array.from(
    { length: 24 },
    (_, index) => `browse-grid-skeleton-${index}`,
  );
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {skeletonKeys.map((key) => (
        <div key={key} className="bg-card border border-border rounded-md p-3">
          <Skeleton className="w-full aspect-square rounded-md mb-2" />
          <Skeleton className="h-4 w-3/4 mb-1" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function ListSkeletonBlock() {
  const skeletonKeys = Array.from(
    { length: 20 },
    (_, index) => `browse-list-skeleton-${index}`,
  );
  return (
    <div className="flex flex-col divide-y divide-border">
      {skeletonKeys.map((key) => (
        <div key={key} className="flex items-center gap-3 px-3 py-2">
          <Skeleton className="w-10 h-10 rounded-md" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-16 ml-auto" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}
