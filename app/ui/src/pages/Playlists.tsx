import { FormField } from "@crate/ui/primitives/FormField";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { FilterChip } from "@crate/ui/primitives/FilterChip";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@crate/ui/shadcn/dropdown-menu";
import { OpsPageHero } from "@/components/admin/ops-surfaces";
import { ListPagination } from "@/components/admin/ListPagination";
import {
  PageHeaderAction,
  PageHeaderActions,
} from "@/components/layout/PageHeader";
import {
  FilePlus2 as HeaderFilePlus2,
  ListPlus as HeaderListPlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Power,
  PowerOff,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  cloneElement,
  type ReactElement,
} from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  PlaylistArtwork,
  type PlaylistArtworkTrack,
} from "@/components/playlists/PlaylistArtwork";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { PlaylistTrackRequirements } from "@/components/playlists/PlaylistTrackRequirements";
import {
  validateFeaturedRank,
  validatePlaylistCreation,
  type CreationErrors,
} from "@/components/playlists/playlist-creation-validation";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";

import { Button } from "@crate/ui/shadcn/button";
import { Card } from "@crate/ui/shadcn/card";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { Input } from "@crate/ui/shadcn/input";
import { Textarea } from "@crate/ui/shadcn/textarea";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { timeAgo } from "@/lib/utils";

interface SystemPlaylist {
  id: number;
  name: string;
  description: string;
  cover_data_url?: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  generation_mode: "static" | "smart";
  is_curated: boolean;
  is_active: boolean;
  auto_refresh_enabled?: boolean;
  featured_rank?: number | null;
  category?: string | null;
  follower_count: number;
  track_count: number;
  total_duration: number;
  generation_status?: string;
  last_generated_at?: string | null;
}

interface FilterOptions {
  genres: string[];
  formats: string[];
  keys: string[];
  artists: string[];
}

interface DraftSmartRule {
  field: string;
  op: string;
  value: string;
  rangeMin: string;
  rangeMax: string;
}

type FilterMode = "all" | "curated" | "smart" | "inactive";
type ComposerMode = "static" | "smart" | null;

const FILTER_OPTIONS: Array<{ key: FilterMode; label: string }> = [
  { key: "all", label: "All" },
  { key: "curated", label: "Curated" },
  { key: "smart", label: "Smart" },
  { key: "inactive", label: "Inactive" },
];
const PLAYLISTS_PAGE_SIZE = 20;

const CATEGORY_OPTIONS = [
  { value: "editorial", label: "Editorial" },
  { value: "genre", label: "Genre" },
  { value: "mood", label: "Mood" },
  { value: "activity", label: "Activity" },
  { value: "era", label: "Era" },
  { value: "seasonal", label: "Seasonal" },
];

const SMART_FIELDS = [
  { value: "genre", label: "Genre", type: "text" },
  { value: "artist", label: "Artist", type: "text" },
  { value: "album", label: "Album", type: "text" },
  { value: "title", label: "Title", type: "text" },
  { value: "format", label: "Format", type: "text" },
  { value: "audio_key", label: "Key", type: "text" },
  { value: "year", label: "Year", type: "number" },
  { value: "bpm", label: "BPM", type: "number" },
  { value: "energy", label: "Energy", type: "number" },
  { value: "danceability", label: "Danceability", type: "number" },
  { value: "valence", label: "Valence", type: "number" },
  { value: "acousticness", label: "Acousticness", type: "number" },
  { value: "popularity", label: "Popularity", type: "number" },
  { value: "rating", label: "Rating", type: "number" },
  { value: "duration", label: "Duration", type: "number" },
] as const;

const TEXT_OPS = [
  { value: "eq", label: "Equals" },
  { value: "neq", label: "Not equals" },
  { value: "contains", label: "Contains" },
  { value: "not_contains", label: "Not contains" },
];

const NUMBER_OPS = [
  { value: "eq", label: "=" },
  { value: "gte", label: ">=" },
  { value: "lte", label: "<=" },
  { value: "between", label: "Between" },
];

const SORT_OPTIONS = [
  { value: "random", label: "Random" },
  { value: "popularity", label: "Popularity" },
  { value: "energy", label: "Energy" },
  { value: "bpm", label: "BPM" },
  { value: "title", label: "Title" },
];

const DROPDOWN_FIELDS: Record<
  string,
  {
    optionsKey: keyof FilterOptions;
    searchPlaceholder: string;
    placeholder: string;
  }
> = {
  artist: {
    optionsKey: "artists",
    searchPlaceholder: "Search artists...",
    placeholder: "Select artist",
  },
  genre: {
    optionsKey: "genres",
    searchPlaceholder: "Search genres...",
    placeholder: "Select genre",
  },
  format: {
    optionsKey: "formats",
    searchPlaceholder: "Search formats...",
    placeholder: "Select format",
  },
  audio_key: {
    optionsKey: "keys",
    searchPlaceholder: "Search keys...",
    placeholder: "Select key",
  },
};

function getFieldType(field: string): "text" | "number" {
  return SMART_FIELDS.find((item) => item.value === field)?.type === "text"
    ? "text"
    : "number";
}

function getOpsForField(field: string) {
  return getFieldType(field) === "text" ? TEXT_OPS : NUMBER_OPS;
}

function formatPlaylistDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function Field({
  label,
  id,
  className = "",
  error,
  children,
}: {
  label: string;
  id?: string;
  className?: string;
  error?: string;
  children: ReactElement<{
    "aria-label"?: string;
    "aria-labelledby"?: string;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
    id?: string;
  }>;
}) {
  return (
    <FormField id={id} label={label} className={className} error={error}>
      {(control) =>
        cloneElement(children, {
          ...control,
          "aria-labelledby":
            children.type === AdminSelect
              ? undefined
              : control["aria-labelledby"],
        })
      }
    </FormField>
  );
}

function TogglePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <FilterChip active={active} onClick={onClick}>
      {label}
    </FilterChip>
  );
}

export function Playlists() {
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<SystemPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(1);
  const [composerMode, setComposerMode] = useState<ComposerMode>(null);
  const [deleteTarget, setDeleteTarget] = useState<SystemPlaylist | null>(null);
  const [deleteError, setDeleteError] = useState(false);

  const fetchPlaylists = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api<SystemPlaylist[]>("/api/admin/system-playlists");
      setPlaylists(Array.isArray(data) ? data : []);
    } catch {
      setLoadError(true);
      toast.error("Failed to load system playlists");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPlaylists();
  }, [fetchPlaylists]);

  const counts = useMemo(
    () => ({
      all: playlists.length,
      curated: playlists.filter((playlist) => playlist.is_curated).length,
      smart: playlists.filter(
        (playlist) => playlist.generation_mode === "smart",
      ).length,
      inactive: playlists.filter((playlist) => !playlist.is_active).length,
    }),
    [playlists],
  );

  const categoryOptions = useMemo(() => {
    const categories = Array.from(
      new Set(
        playlists
          .map((playlist) => playlist.category?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ).sort((a, b) => a.localeCompare(b));

    return categories.map((category) => ({ value: category, label: category }));
  }, [playlists]);

  const filteredPlaylists = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return playlists.filter((playlist) => {
      const matchesMode =
        filter === "all" ||
        (filter === "curated" && playlist.is_curated) ||
        (filter === "smart" && playlist.generation_mode === "smart") ||
        (filter === "inactive" && !playlist.is_active);

      if (!matchesMode) return false;

      if (categoryFilter && (playlist.category ?? "") !== categoryFilter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        playlist.name,
        playlist.description,
        playlist.category,
        playlist.generation_mode,
        playlist.is_curated ? "curated" : "",
        playlist.is_active ? "active" : "inactive",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [categoryFilter, filter, playlists, query]);
  const pageCount = Math.max(
    1,
    Math.ceil(filteredPlaylists.length / PLAYLISTS_PAGE_SIZE),
  );
  const currentPage = Math.min(page, pageCount);
  const visiblePlaylists = filteredPlaylists.slice(
    (currentPage - 1) * PLAYLISTS_PAGE_SIZE,
    currentPage * PLAYLISTS_PAGE_SIZE,
  );

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteError(false);
    await api(`/api/admin/system-playlists/${deleteTarget.id}`, "DELETE");
    toast.success(`Deleted "${deleteTarget.name}"`);
    setDeleteTarget(null);
    void fetchPlaylists();
  }

  async function toggleActive(playlist: SystemPlaylist) {
    try {
      await api(
        `/api/admin/system-playlists/${playlist.id}/${
          playlist.is_active ? "deactivate" : "activate"
        }`,
        "POST",
      );
      toast.success(
        playlist.is_active ? "Playlist deactivated" : "Playlist activated",
      );
      void fetchPlaylists();
    } catch {
      toast.error("Failed to update status");
    }
  }

  function handleCreated(playlist: SystemPlaylist) {
    setComposerMode(null);
    void fetchPlaylists();
    navigate(`/playlists/${playlist.id}`);
  }

  return (
    <div className="min-w-0 space-y-6">
      <OpsPageHero
        title="System Playlists"
        description="Editorial playlists for Listen, with smart generation and Admin controls."
        compactActions
        actions={
          <PageHeaderActions>
            <PageHeaderAction
              label="New static"
              onClick={() =>
                setComposerMode((current) =>
                  current === "static" ? null : "static",
                )
              }
              aria-pressed={composerMode === "static"}
            >
              <HeaderFilePlus2
                data-admin-ux="header-new-static"
                aria-hidden="true"
              />
            </PageHeaderAction>
            <PageHeaderAction
              label="New smart"
              onClick={() =>
                setComposerMode((current) =>
                  current === "smart" ? null : "smart",
                )
              }
              aria-pressed={composerMode === "smart"}
            >
              <HeaderListPlus
                data-admin-ux="header-new-smart"
                aria-hidden="true"
              />
            </PageHeaderAction>
          </PageHeaderActions>
        }
      />

      <div className="space-y-3 border-t border-border-quiet pt-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
          <div className="crate-form-field min-w-0 flex-1">
            <label
              htmlFor="playlists-search"
              className="font-mono font-normal text-meta text-text-muted"
            >
              Search playlists
            </label>
            <div className="relative">
              <Search
                data-admin-ux="playlists-search"
                aria-hidden="true"
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="playlists-search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search playlists by name, description or category"
                className="pl-9"
              />
            </div>
          </div>
          <div className="crate-form-field">
            <MonoLabel as="span">Category</MonoLabel>
            <AdminSelect
              value={categoryFilter}
              onChange={(value) => {
                setCategoryFilter(value);
                setPage(1);
              }}
              options={categoryOptions}
              placeholder="All categories"
              searchable
              searchPlaceholder="Search categories..."
              triggerClassName="w-full lg:w-[220px]"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {FILTER_OPTIONS.map((item) => (
              <FilterChip
                key={item.key}
                active={filter === item.key}
                onClick={() => {
                  setFilter(item.key);
                  setPage(1);
                }}
              >
                {item.label}
                <span>
                  {item.key === "all"
                    ? counts.all
                    : item.key === "curated"
                      ? counts.curated
                      : item.key === "smart"
                        ? counts.smart
                        : counts.inactive}
                </span>
              </FilterChip>
            ))}
          </div>
        </div>
      </div>

      {composerMode === "static" ? (
        <CreateStaticPlaylistPanel
          onCreated={handleCreated}
          onCancel={() => setComposerMode(null)}
        />
      ) : null}

      {composerMode === "smart" ? (
        <CreateSmartPlaylistPanel
          onCreated={handleCreated}
          onCancel={() => setComposerMode(null)}
        />
      ) : null}

      {!loading && loadError && playlists.length > 0 ? (
        <ErrorState
          message="System playlists could not be refreshed. Showing the last successful results."
          onRetry={() => void fetchPlaylists()}
          retryLabel="Retry playlists"
        />
      ) : null}

      {loading ? (
        <div
          role="status"
          aria-label="Loading playlists"
          className="flex items-center justify-center gap-2 py-16 text-muted-foreground"
        >
          <Loader2
            data-admin-ux="playlists-loading"
            aria-hidden="true"
            size={16}
            className="animate-spin"
          />{" "}
          Loading playlists…
        </div>
      ) : loadError && playlists.length === 0 ? (
        <ErrorState
          message="System playlists could not be loaded."
          onRetry={() => void fetchPlaylists()}
          retryLabel="Retry playlists"
        />
      ) : filteredPlaylists.length === 0 ? (
        <Card className="p-10 text-center">
          <h2 className="text-lg font-medium font-display">
            No playlists for this view yet
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Try a different search or filter, or start a new playlist from the
            composer above.
          </p>
        </Card>
      ) : (
        <>
          <HairlineList
            as="ul"
            label="System playlists"
            className="mt-3 space-y-4"
          >
            {visiblePlaylists.map((playlist) => (
              <HairlineRow
                key={playlist.id}
                truncate={false}
                className="items-stretch gap-2 py-0 md:gap-4"
                trailing={
                  <div className="flex h-full shrink-0 items-center">
                    <div className="hidden md:flex">
                      <PageHeaderActions label={`Actions for ${playlist.name}`}>
                        <PageHeaderAction
                          label={`Edit ${playlist.name}`}
                          tooltip="Edit"
                          onClick={() => navigate(`/playlists/${playlist.id}`)}
                        >
                          <Pencil
                            data-admin-ux="playlists-open-editor"
                            aria-hidden="true"
                          />
                        </PageHeaderAction>
                        <PageHeaderAction
                          label={`${playlist.is_active ? "Deactivate" : "Activate"} ${playlist.name}`}
                          tooltip={
                            playlist.is_active ? "Deactivate" : "Activate"
                          }
                          onClick={() => void toggleActive(playlist)}
                        >
                          {playlist.is_active ? (
                            <PowerOff
                              data-admin-ux="playlists-deactivate"
                              aria-hidden="true"
                            />
                          ) : (
                            <Power
                              data-admin-ux="playlists-activate"
                              aria-hidden="true"
                            />
                          )}
                        </PageHeaderAction>
                        <PageHeaderAction
                          label={`Delete ${playlist.name}`}
                          tooltip="Delete"
                          onClick={() => setDeleteTarget(playlist)}
                        >
                          <Trash2
                            data-admin-ux="playlists-delete"
                            aria-hidden="true"
                          />
                        </PageHeaderAction>
                      </PageHeaderActions>
                    </div>
                    <div className="md:hidden">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Actions for ${playlist.name}`}
                            className="size-11"
                          >
                            <MoreHorizontal
                              data-admin-ux="playlists-mobile-actions"
                              aria-hidden="true"
                            />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() =>
                              navigate(`/playlists/${playlist.id}`)
                            }
                          >
                            Edit playlist
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => void toggleActive(playlist)}
                          >
                            {playlist.is_active ? "Deactivate" : "Activate"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => setDeleteTarget(playlist)}
                          >
                            Delete playlist
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                }
              >
                <Link
                  to={`/playlists/${playlist.id}`}
                  aria-label={`Open ${playlist.name}`}
                  className="flex min-h-28 min-w-0 flex-1 items-stretch gap-2 py-0 md:min-h-44 md:gap-4"
                >
                  <div
                    data-slot="playlist-row-content"
                    className="flex min-h-28 min-w-0 flex-1 items-stretch gap-2 md:min-h-44 md:gap-4"
                  >
                    <PlaylistArtwork
                      name={playlist.name}
                      coverDataUrl={playlist.cover_data_url}
                      tracks={playlist.artwork_tracks}
                      className="size-28 shrink-0 self-stretch rounded-sm border border-border-quiet bg-canvas-surface object-cover md:size-44"
                    />

                    <div
                      data-slot="playlist-row-information"
                      className="flex min-h-28 min-w-0 flex-1 flex-col justify-between gap-2 py-0 md:min-h-44 md:py-2"
                    >
                      <div className="grid min-w-0 gap-2">
                        <div className="flex min-w-0 flex-nowrap gap-1.5 overflow-x-auto">
                          <InfoBadge
                            active={playlist.generation_mode === "smart"}
                          >
                            {playlist.generation_mode}
                          </InfoBadge>
                          <InfoBadge active={playlist.is_curated}>
                            {playlist.is_curated ? "curated" : "internal"}
                          </InfoBadge>
                          <InfoBadge active={playlist.is_active}>
                            {playlist.is_active ? "active" : "inactive"}
                          </InfoBadge>
                          {playlist.generation_mode === "smart" ? (
                            <InfoBadge active={playlist.auto_refresh_enabled}>
                              auto-refresh
                            </InfoBadge>
                          ) : null}
                          {playlist.generation_status === "running" ||
                          playlist.generation_status === "queued" ||
                          playlist.generation_status === "failed" ? (
                            <InfoBadge
                              tone={
                                playlist.generation_status === "failed"
                                  ? "danger"
                                  : playlist.generation_status === "queued"
                                    ? "warning"
                                    : "info"
                              }
                            >
                              {playlist.generation_status === "running"
                                ? "generating"
                                : playlist.generation_status}
                            </InfoBadge>
                          ) : null}
                        </div>
                        <div className="grid min-w-0 gap-1">
                          <h2 className="m-0 truncate font-display text-base font-semibold text-text-primary md:text-lg">
                            {playlist.name}
                          </h2>
                          <p className="m-0 line-clamp-1 text-sm leading-5 text-text-muted md:line-clamp-2">
                            {playlist.description ||
                              "No editorial description yet."}
                          </p>
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-nowrap gap-1.5 overflow-x-auto">
                        <InfoBadge>{playlist.track_count} tracks</InfoBadge>
                        <InfoBadge>
                          {formatPlaylistDuration(playlist.total_duration)}
                        </InfoBadge>
                        <InfoBadge>
                          {playlist.follower_count ?? 0} follower
                          {playlist.follower_count === 1 ? "" : "s"}
                        </InfoBadge>
                        {playlist.category ? (
                          <InfoBadge>{playlist.category}</InfoBadge>
                        ) : null}
                        {playlist.featured_rank != null ? (
                          <InfoBadge>Rank {playlist.featured_rank}</InfoBadge>
                        ) : null}
                        {playlist.last_generated_at ? (
                          <InfoBadge>
                            Generated {timeAgo(playlist.last_generated_at)}
                          </InfoBadge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </Link>
              </HairlineRow>
            ))}
          </HairlineList>
        </>
      )}

      {!loading && filteredPlaylists.length > 0 ? (
        <ListPagination
          label="playlists"
          itemCount={filteredPlaylists.length}
          page={currentPage}
          pageSize={PLAYLISTS_PAGE_SIZE}
          onPageChange={setPage}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(false);
          }
        }}
        title="Delete system playlist"
        description={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        onError={() => {
          setDeleteError(true);
          toast.error("Failed to delete system playlist");
        }}
        body={
          deleteError ? (
            <ErrorState message="Playlist could not be deleted. Try again." />
          ) : undefined
        }
        eyebrow="Confirm action"
        consequence={`${deleteTarget?.name ?? "Playlist"} · ${
          deleteTarget?.track_count ?? 0
        } track references · deletes the system playlist`}
      />
    </div>
  );
}

function CreateStaticPlaylistPanel({
  onCreated,
  onCancel,
}: {
  onCreated: (playlist: SystemPlaylist) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("editorial");
  const [featuredRank, setFeaturedRank] = useState("");
  const [isCurated, setIsCurated] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rankError, setRankError] = useState<string>();

  async function submit() {
    if (!name.trim()) return;
    const rank = validateFeaturedRank(featuredRank);
    setRankError(rank.error);
    if (rank.error) return;
    setSaving(true);
    try {
      const playlist = await api<SystemPlaylist>(
        "/api/admin/system-playlists",
        "POST",
        {
          name: name.trim(),
          description: description.trim(),
          category,
          featured_rank: rank.value,
          generation_mode: "static",
          is_curated: isCurated,
          is_active: isActive,
        },
      );
      toast.success("Static playlist created");
      onCreated(playlist);
    } catch {
      toast.error("Failed to create static playlist");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div>
                <h2 className="text-lg font-semibold font-display">
                  New static playlist
                </h2>
                <p className="text-sm text-muted-foreground">
                  Create the editorial shell, then continue in the dedicated
                  editor.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <TogglePill
                label="Curated in listen"
                active={isCurated}
                onClick={() => setIsCurated((v) => !v)}
              />
              <TogglePill
                label="Active"
                active={isActive}
                onClick={() => setIsActive((v) => !v)}
              />
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="min-h-11"
            onClick={onCancel}
          >
            <X
              data-admin-ux="playlists-static-close"
              aria-hidden="true"
              size={14}
              className="mr-1"
            />{" "}
            Close
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_220px_180px]">
          <FormField label="Name">
            <Input
              aria-label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Playlist name"
            />
          </FormField>
          <Field label="Category">
            <AdminSelect
              placeholder="Category"
              value={category}
              onChange={setCategory}
              options={CATEGORY_OPTIONS}
              allowClear={false}
              triggerClassName="w-full max-w-none"
            />
          </Field>
          <Field label="Featured rank" error={rankError}>
            <Input
              type="number"
              aria-label="Featured rank"
              value={featuredRank}
              onChange={(event) => setFeaturedRank(event.target.value)}
              placeholder="Optional"
            />
          </Field>
          <FormField label="Description" className="lg:col-span-3">
            <Textarea
              aria-label="Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Short editorial description for listen"
              rows={4}
            />
          </FormField>
        </div>

        <div className="flex flex-col gap-3 border-t border-border-quiet pt-4 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-muted-foreground">
            Static playlists open in the editor right after creation so cover
            and editorial metadata stay in the same workflow.
          </p>
          <div className="flex items-center gap-2">
            <Button className="min-h-11" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              className="min-h-11"
              onClick={submit}
              disabled={saving || !name.trim()}
            >
              {saving ? (
                <Loader2
                  data-admin-ux="playlists-static-saving"
                  aria-hidden="true"
                  size={14}
                  className="mr-1 animate-spin"
                />
              ) : null}
              Create & open
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function CreateSmartPlaylistPanel({
  onCreated,
  onCancel,
}: {
  onCreated: (playlist: SystemPlaylist) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("editorial");
  const [featuredRank, setFeaturedRank] = useState("");
  const [isCurated, setIsCurated] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [requireFullMixProfile, setRequireFullMixProfile] = useState(false);
  const [rules, setRules] = useState<DraftSmartRule[]>([
    { field: "genre", op: "contains", value: "", rangeMin: "", rangeMax: "" },
  ]);
  const [limit, setLimit] = useState("50");
  const [match, setMatch] = useState<"all" | "any">("all");
  const [sort, setSort] = useState("random");
  const [saving, setSaving] = useState(false);
  const {
    data: filterOptions,
    loading: optionsLoading,
    error: optionsError,
    refetch: refetchOptions,
  } = useApi<FilterOptions>("/api/playlists/filter-options");
  const [errors, setErrors] = useState<CreationErrors>({ byRule: {} });
  const needsOptions = rules.some((rule) =>
    Boolean(DROPDOWN_FIELDS[rule.field]),
  );

  function updateRule(index: number, patch: Partial<DraftSmartRule>) {
    setRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    );
  }

  function addRule() {
    setRules((current) => [
      ...current,
      { field: "genre", op: "contains", value: "", rangeMin: "", rangeMax: "" },
    ]);
  }

  function removeRule(index: number) {
    setRules((current) =>
      current.filter((_, ruleIndex) => ruleIndex !== index),
    );
  }

  function updateRuleField(index: number, field: string) {
    const nextOp = getOpsForField(field)[0]?.value ?? "eq";
    updateRule(index, {
      field,
      op: nextOp,
      value: "",
      rangeMin: "",
      rangeMax: "",
    });
  }

  async function submit() {
    if (!name.trim()) return;
    const validation = validatePlaylistCreation({ rules, limit, featuredRank });
    setErrors(validation.errors);
    if (!validation.valid || (needsOptions && !filterOptions)) return;

    setSaving(true);
    try {
      const playlist = await api<SystemPlaylist>(
        "/api/admin/system-playlists",
        "POST",
        {
          name: name.trim(),
          description: description.trim(),
          category,
          featured_rank: validation.featuredRank,
          generation_mode: "smart",
          is_curated: isCurated,
          is_active: isActive,
          auto_refresh_enabled: autoRefreshEnabled,
          smart_rules: {
            match,
            rules: validation.rules,
            limit: validation.limit,
            sort,
            ...(requireFullMixProfile
              ? { require_full_mix_profile: true }
              : {}),
          },
        },
      );
      toast.success("Smart playlist created and queued");
      onCreated(playlist);
    } catch {
      toast.error("Failed to create smart playlist");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div>
                <h2 className="text-lg font-semibold font-display">
                  New smart playlist
                </h2>
                <p className="text-sm text-muted-foreground">
                  Define the editorial shell, add rules, and jump straight into
                  the editor once generation is queued.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <TogglePill
                label="Curated in listen"
                active={isCurated}
                onClick={() => setIsCurated((v) => !v)}
              />
              <TogglePill
                label="Active"
                active={isActive}
                onClick={() => setIsActive((v) => !v)}
              />
              <TogglePill
                label="Auto-refresh daily"
                active={autoRefreshEnabled}
                onClick={() => setAutoRefreshEnabled((v) => !v)}
              />
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="min-h-11"
            onClick={onCancel}
          >
            <X
              data-admin-ux="playlists-smart-close"
              aria-hidden="true"
              size={14}
              className="mr-1"
            />{" "}
            Close
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_220px_180px]">
          <FormField label="Name">
            <Input
              aria-label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Playlist name"
            />
          </FormField>
          <Field label="Category">
            <AdminSelect
              placeholder="Category"
              value={category}
              onChange={setCategory}
              options={CATEGORY_OPTIONS}
              allowClear={false}
              triggerClassName="w-full max-w-none"
            />
          </Field>
          <Field label="Featured rank" error={errors.featuredRank}>
            <Input
              type="number"
              aria-label="Featured rank"
              value={featuredRank}
              onChange={(event) => setFeaturedRank(event.target.value)}
              placeholder="Optional"
            />
          </Field>
          <FormField label="Description" className="lg:col-span-3">
            <Textarea
              aria-label="Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Editorial summary shown in listen"
              rows={4}
            />
          </FormField>
        </div>

        <div className="rounded-md border border-border-quiet bg-canvas-surface p-4">
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h3 className="text-sm font-semibold font-display">
                Rule composer
              </h3>
              <p className="text-sm text-muted-foreground">
                Build the first pass here, then refine in the editor after
                creation if needed.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Field label="Match" className="min-w-[180px]">
                <AdminSelect
                  placeholder="Match"
                  value={match}
                  onChange={(value) => setMatch(value as "all" | "any")}
                  options={[
                    { value: "all", label: "All rules" },
                    { value: "any", label: "Any rule" },
                  ]}
                  allowClear={false}
                  triggerClassName="w-full max-w-none"
                />
              </Field>
              <Field label="Limit" className="w-[120px]" error={errors.limit}>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  aria-label="Limit"
                  value={limit}
                  onChange={(event) => setLimit(event.target.value)}
                />
              </Field>
              <Field label="Sort" className="min-w-[180px]">
                <AdminSelect
                  placeholder="Sort"
                  value={sort}
                  onChange={setSort}
                  options={SORT_OPTIONS}
                  allowClear={false}
                  triggerClassName="w-full max-w-none"
                />
              </Field>
            </div>
          </div>

          <PlaylistTrackRequirements
            className="mb-4"
            value={requireFullMixProfile}
            onChange={setRequireFullMixProfile}
            disabled={saving}
          />

          {!filterOptions && optionsLoading ? (
            <LoadingState label="Loading rule options" />
          ) : null}
          {optionsError ? (
            <ErrorState
              message={
                filterOptions
                  ? "Rule options could not be refreshed. Showing the last loaded options."
                  : "Rule options could not be loaded."
              }
              onRetry={() => void refetchOptions()}
              retryLabel="Retry rule options"
            />
          ) : null}
          {errors.rules ? (
            <p role="alert" className="mb-3 text-sm text-state-warning-text">
              {errors.rules}
            </p>
          ) : null}
          <div className="space-y-3">
            {rules.map((rule, index) => {
              const ops = getOpsForField(rule.field);
              const dropdownConfig = DROPDOWN_FIELDS[rule.field];
              const dropdownOptions =
                dropdownConfig && filterOptions
                  ? filterOptions[dropdownConfig.optionsKey].map((value) => ({
                      value,
                      label: value,
                    }))
                  : [];

              return (
                <div
                  key={index}
                  className="@container rounded-md border border-border-quiet bg-canvas-surface p-3"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <InfoBadge>Rule {index + 1}</InfoBadge>
                    <ActionIconButton
                      onClick={() => removeRule(index)}
                      disabled={rules.length === 1}
                      title={`Remove rule ${index + 1}`}
                    >
                      <Trash2
                        data-admin-ux="playlists-remove-rule"
                        aria-hidden="true"
                      />
                    </ActionIconButton>
                  </div>

                  <div className="grid gap-3 @xl:grid-cols-[180px_160px_minmax(0,1fr)]">
                    <Field label="Field">
                      <AdminSelect
                        value={rule.field}
                        onChange={(value) => updateRuleField(index, value)}
                        options={SMART_FIELDS.map((field) => ({
                          value: field.value,
                          label: field.label,
                        }))}
                        placeholder="Field"
                        allowClear={false}
                        triggerClassName="w-full max-w-none"
                      />
                    </Field>

                    <Field label="Operator">
                      <AdminSelect
                        value={rule.op}
                        onChange={(value) =>
                          updateRule(index, {
                            op: value,
                            value: "",
                            rangeMin: "",
                            rangeMax: "",
                          })
                        }
                        options={ops}
                        allowClear={false}
                        placeholder="Operator"
                        triggerClassName="w-full max-w-none"
                      />
                    </Field>

                    <Field
                      id={`playlist-rule-${index}`}
                      label="Value"
                      error={errors.byRule[index]}
                    >
                      {rule.op === "between" ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Input
                            type="number"
                            aria-label="Minimum"
                            aria-invalid={
                              Boolean(errors.byRule[index]) || undefined
                            }
                            aria-describedby={
                              errors.byRule[index]
                                ? `playlist-rule-${index}-error`
                                : undefined
                            }
                            value={rule.rangeMin}
                            onChange={(event) =>
                              updateRule(index, {
                                rangeMin: event.target.value,
                              })
                            }
                            placeholder="Minimum"
                          />
                          <Input
                            type="number"
                            aria-label="Maximum"
                            aria-invalid={
                              Boolean(errors.byRule[index]) || undefined
                            }
                            aria-describedby={
                              errors.byRule[index]
                                ? `playlist-rule-${index}-error`
                                : undefined
                            }
                            value={rule.rangeMax}
                            onChange={(event) =>
                              updateRule(index, {
                                rangeMax: event.target.value,
                              })
                            }
                            placeholder="Maximum"
                          />
                        </div>
                      ) : dropdownConfig ? (
                        <AdminSelect
                          value={rule.value}
                          onChange={(value) => updateRule(index, { value })}
                          options={dropdownOptions}
                          placeholder={dropdownConfig.placeholder}
                          disabled={!filterOptions || saving}
                          searchable
                          searchPlaceholder={dropdownConfig.searchPlaceholder}
                          allowClear={false}
                          triggerClassName="w-full max-w-none"
                        />
                      ) : (
                        <Input
                          aria-label="Value"
                          value={rule.value}
                          onChange={(event) =>
                            updateRule(index, { value: event.target.value })
                          }
                          placeholder="Value"
                        />
                      )}
                    </Field>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border-quiet pt-4">
            <p className="text-sm text-muted-foreground">
              Prefer one condition per rule. If you need multiple buckets,
              create more rules and switch match mode to `Any`.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={addRule}
              disabled={rules.length >= 12 || saving}
            >
              Add rule
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-border-quiet pt-4 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-muted-foreground">
            Smart playlists queue their first generation immediately, then you
            continue in the editor for cover, status and later refinements.
          </p>
          <div className="flex items-center gap-2">
            <Button className="min-h-11" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              className="min-h-11"
              onClick={submit}
              disabled={
                saving || !name.trim() || (needsOptions && !filterOptions)
              }
            >
              {saving ? (
                <Loader2
                  data-admin-ux="playlists-smart-saving"
                  aria-hidden="true"
                  size={14}
                  className="mr-1 animate-spin"
                />
              ) : null}
              Create & open
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
