import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { FilterChip } from "@crate/ui/primitives/FilterChip";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { TooltipHint } from "@crate/ui/shadcn/tooltip";
import { UpcomingEventRow } from "@crate/ui/domain/shows/UpcomingEventRow";
import { UpcomingDateStamp } from "@crate/ui/domain/shows/UpcomingDateStamp";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import {
  CRATE_ICON_SIZE,
  Disc3,
  Download as DownloadIcon,
} from "@crate/ui/icons";
import {
  PageHeaderAction,
  PageHeaderActions,
} from "@/components/layout/PageHeader";
import {
  List as HeaderList,
  LayoutGrid as HeaderLayoutGrid,
  Radar as HeaderRadar,
  Loader2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import {
  OpsPageHero,
  OpsPanel,
  OpsSurface,
  OpsStatTile,
} from "@/components/admin/ops-surfaces";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { Button } from "@crate/ui/shadcn/button";
import { ListPagination } from "@/components/admin/ListPagination";

import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { api, apiSseUrl } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";
import { waitForTask } from "@/lib/tasks";
import { useApi } from "@/hooks/use-api";
import { timeAgo } from "@/lib/utils";
import { SearchInput } from "@crate/ui/primitives/SearchInput";

interface Release {
  id: number;
  artist_name: string;
  artist_id?: number;
  artist_slug?: string;
  album_title: string;
  album_id?: number;
  album_slug?: string;
  tidal_id: string;
  tidal_url: string;
  cover_url: string;
  year: string;
  release_date: string | null;
  release_type: string | null;
  tracks: number | null;
  available_tracks?: number | null;
  quality: string;
  status: string;
  detected_at: string;
  downloaded_at: string | null;
}

interface NewReleasesSurface {
  releases: Release[];
}

const EMPTY_RELEASES: Release[] = [];

type ViewMode = "timeline" | "grid";
type StatusFilter = "all" | "detected" | "downloading" | "downloaded";
type DateFilter = "" | "upcoming" | "released" | "unknown";
const RELEASES_PAGE_SIZE = 20;

function releaseArtistHref(release: Release) {
  if (release.artist_id == null) return undefined;
  return artistPagePath({
    artistId: release.artist_id,
    artistSlug: release.artist_slug,
    artistName: release.artist_name,
  });
}

function releaseAlbumHref(release: Release) {
  if (release.album_id == null) return undefined;
  return albumPagePath({
    albumId: release.album_id,
    albumSlug: release.album_slug,
    artistName: release.artist_name,
    albumName: release.album_title,
  });
}

function isUpcomingRelease(release: Release) {
  const date = release.release_date;
  if (!date) return false;
  return date >= new Date().toISOString().slice(0, 10);
}

function compareRadarDates(left: Release, right: Release) {
  const bucket = (release: Release) =>
    !release.release_date ? 2 : isUpcomingRelease(release) ? 0 : 1;
  const leftBucket = bucket(left);
  const rightBucket = bucket(right);
  if (leftBucket !== rightBucket) return leftBucket - rightBucket;
  if (leftBucket === 0)
    return (left.release_date || "").localeCompare(right.release_date || "");
  if (leftBucket === 1)
    return (right.release_date || "").localeCompare(left.release_date || "");
  return (right.detected_at || "").localeCompare(left.detected_at || "");
}

function ReleaseDateBadge({ release }: { release: Release }) {
  if (release.release_date) {
    const value = new Date(`${release.release_date}T12:00:00`);
    const valid =
      !Number.isNaN(value.getTime()) &&
      /^\d{4}-\d{2}-\d{2}$/.test(release.release_date) &&
      value.getFullYear() === Number(release.release_date.slice(0, 4)) &&
      value.getMonth() + 1 === Number(release.release_date.slice(5, 7)) &&
      value.getDate() === Number(release.release_date.slice(8, 10));
    if (valid)
      return <UpcomingDateStamp date={release.release_date} locale="en-US" />;
    return (
      <TooltipHint content={release.release_date}>
        <span
          data-slot="upcoming-date-invalid"
          aria-label="Unknown release date"
          className="w-14 shrink-0 truncate px-1 text-center font-mono text-label text-text-secondary"
        >
          {release.release_date}
        </span>
      </TooltipHint>
    );
  }
  return (
    <div
      data-slot="upcoming-date-unknown"
      className="flex w-14 shrink-0 flex-col items-center justify-center gap-1 px-2"
      aria-label="Release date unknown"
    >
      <MonoLabel as="span">TBA</MonoLabel>
      <span className="font-display text-2xl font-bold leading-none tracking-display text-text-primary tabular-nums">
        —
      </span>
      <MonoLabel as="span">DATE</MonoLabel>
    </div>
  );
}

function releaseTimingLabel(release: Release) {
  if (!release.release_date) return "Date unconfirmed";
  if (!isUpcomingRelease(release)) return "Released";
  const days = Math.ceil(
    (new Date(`${release.release_date}T00:00:00`).getTime() - Date.now()) /
      86_400_000,
  );
  return days <= 0 ? "Release day" : `${days} days to go`;
}

function ReleaseRowActions({
  release,
  onDownload,
  onDismiss,
}: {
  release: Release;
  onDownload?: (id: number) => void;
  onDismiss?: (id: number) => void;
}) {
  const downloading = release.status === "downloading";
  const downloaded = release.status === "downloaded";
  return (
    <div className="flex flex-col items-end gap-1">
      {downloaded ? <InfoBadge tone="success">Downloaded</InfoBadge> : null}
      {downloading ? (
        <InfoBadge active>
          <Loader2
            aria-hidden="true"
            data-admin-ux="releases-download-loading"
            size={12}
            className="animate-spin"
          />
          Downloading
        </InfoBadge>
      ) : null}
      {!downloaded && !downloading ? (
        <ActionGroup label={`Actions for ${release.album_title}`}>
          {release.tidal_url && onDownload ? (
            <ActionButton
              label="Download"
              onClick={() => onDownload(release.id)}
            >
              <DownloadIcon
                size={CRATE_ICON_SIZE.md}
                data-admin-ux="releases-timeline-download"
              />
            </ActionButton>
          ) : null}
          {onDismiss ? (
            <ActionButton
              label="Dismiss release"
              onClick={() => onDismiss(release.id)}
            >
              <X
                size={CRATE_ICON_SIZE.md}
                aria-hidden="true"
                data-admin-ux="releases-timeline-dismiss"
              />
            </ActionButton>
          ) : null}
        </ActionGroup>
      ) : null}
    </div>
  );
}

function ReleaseMeta({ release }: { release: Release }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
      {release.release_type ? (
        <InfoBadge>{release.release_type}</InfoBadge>
      ) : null}
      {release.quality ? (
        <InfoBadge tone="accent">{release.quality}</InfoBadge>
      ) : null}
      {!release.release_date && release.year ? (
        <InfoBadge>{release.year}</InfoBadge>
      ) : null}
      {release.tracks != null && release.tracks > 0 ? (
        <InfoBadge>{release.tracks} tracks</InfoBadge>
      ) : null}
      {release.available_tracks != null ? (
        <InfoBadge
          tone={
            release.tracks != null && release.available_tracks >= release.tracks
              ? "success"
              : "accent"
          }
          title="Tracks already available in this library"
        >
          {release.available_tracks} / {release.tracks ?? "?"} in library
        </InfoBadge>
      ) : null}
      <InfoBadge>{timeAgo(release.detected_at)}</InfoBadge>
    </div>
  );
}

function ReleaseTimelineRow({
  release,
  onDownload,
  onDismiss,
}: {
  release: Release;
  onDownload?: (id: number) => void;
  onDismiss?: (id: number) => void;
}) {
  const albumHref = releaseAlbumHref(release);
  const availability =
    release.available_tracks != null
      ? `${release.available_tracks} / ${release.tracks ?? "?"} in library`
      : null;

  return (
    <article
      data-slot="release-radar-row"
      aria-label={`${release.album_title} by ${release.artist_name}`}
      className="item-action-target overflow-hidden rounded-panel border border-border-quiet bg-surface-object transition-colors hover:border-border-interactive"
    >
      <UpcomingEventRow
        artwork={
          <MediaCover
            data-admin-ux="releases-timeline-cover"
            src={release.cover_url}
            alt=""
            fallbackIcon={Disc3}
            iconSize={CRATE_ICON_SIZE.xl}
            size={88}
            className="rounded-none"
          />
        }
        href={albumHref}
        openLabel={albumHref ? release.album_title : undefined}
        details={
          <>
            <span className="block truncate text-caption font-semibold text-text-primary">
              {release.album_title}
            </span>
            <MonoLabel
              as="span"
              className="mt-1 block truncate"
              meta={[
                release.artist_name,
                release.release_type,
                release.quality,
                release.tracks != null ? `${release.tracks} tracks` : null,
              ]}
            />
            <TooltipHint
              content={
                release.detected_at
                  ? `Detected ${timeAgo(release.detected_at)}`
                  : undefined
              }
            >
              <MonoLabel
                as="span"
                className="mt-1 block truncate"
                accent={releaseTimingLabel(release)}
                meta={[release.status, availability]}
              />
            </TooltipHint>
          </>
        }
        date={<ReleaseDateBadge release={release} />}
        actionsClassName="px-1.5"
        actions={
          <ReleaseRowActions
            release={release}
            onDownload={onDownload}
            onDismiss={onDismiss}
          />
        }
      />
    </article>
  );
}

function ReleaseGridCard({
  release,
  onDownload,
  onDismiss,
}: {
  release: Release;
  onDownload?: (id: number) => void;
  onDismiss?: (id: number) => void;
}) {
  const albumHref = releaseAlbumHref(release);
  const artistHref = releaseArtistHref(release);

  return (
    <OpsSurface
      as="article"
      aria-label={`${release.album_title} by ${release.artist_name}`}
      className="group overflow-hidden p-0"
    >
      <div className="relative aspect-square bg-surface-canvas">
        <MediaCover
          data-admin-ux="releases-card-cover"
          src={release.cover_url}
          alt=""
          fallbackIcon={Disc3}
          iconSize={CRATE_ICON_SIZE.xl}
          size="fill"
          className="rounded-none"
        />

        <div className="absolute left-3 top-3">
          {release.status === "detected" ? (
            <InfoBadge active>Detected</InfoBadge>
          ) : null}
          {release.status === "downloading" ? (
            <InfoBadge active>Downloading</InfoBadge>
          ) : null}
          {release.status === "downloaded" ? (
            <InfoBadge tone="success">Downloaded</InfoBadge>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="space-y-1">
          {albumHref ? (
            <Link
              to={albumHref}
              className="block truncate text-sm font-semibold text-text-primary transition-colors hover:text-accent-action-hi"
            >
              {release.album_title}
            </Link>
          ) : (
            <div className="truncate text-sm font-semibold text-text-primary">
              {release.album_title}
            </div>
          )}
          {artistHref ? (
            <Link
              to={artistHref}
              className="block truncate text-xs text-text-muted transition-colors hover:text-accent-action-hi"
            >
              {release.artist_name}
            </Link>
          ) : (
            <div className="truncate text-xs text-text-muted">
              {release.artist_name}
            </div>
          )}
        </div>

        <ReleaseMeta release={release} />

        <div className="flex items-center gap-2">
          {release.status === "detected" && release.tidal_url && onDownload ? (
            <Button
              size="sm"
              className="flex-1 gap-2"
              onClick={() => onDownload(release.id)}
            >
              Download
            </Button>
          ) : null}
          {release.status === "detected" && onDismiss ? (
            <ActionButton
              label="Dismiss release"
              onClick={() => onDismiss(release.id)}
            >
              <X
                size={CRATE_ICON_SIZE.md}
                aria-hidden="true"
                data-admin-ux="releases-grid-dismiss"
              />
            </ActionButton>
          ) : null}
        </div>
      </div>
    </OpsSurface>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <OpsSurface role="status" className="px-4 py-16 text-center">
      <h3 className="font-display text-lg font-semibold text-text-primary">
        {title}
      </h3>
      <p className="mx-auto mt-2 max-w-xl text-sm text-text-muted">
        {description}
      </p>
    </OpsSurface>
  );
}

export function NewReleases() {
  const { hasCapability, hasAnyCapability } = useAuth();
  const canCurateReleases = hasCapability("curation.releases.write");
  const canAcquireReleases = hasAnyCapability([
    "curation.releases.write",
    "library.tidal.manage",
  ]);
  const {
    data: releaseSurface,
    loading,
    error,
    refetch,
  } = useApi<NewReleasesSurface>("/api/acquisition/new-releases/snapshot");
  const [liveSurface, setLiveSurface] = useState<NewReleasesSurface | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("detected");
  const [dateFilter, setDateFilter] = useState<DateFilter>("");
  const [typeFilter, setTypeFilter] = useState("");
  const [view, setView] = useState<ViewMode>("timeline");
  const [page, setPage] = useState(1);
  const releases =
    liveSurface?.releases ?? releaseSurface?.releases ?? EMPTY_RELEASES;

  useEffect(() => {
    const stream = new EventSource(
      apiSseUrl("/api/acquisition/new-releases/stream"),
    );
    stream.onmessage = (event) => {
      try {
        const next = JSON.parse(event.data) as NewReleasesSurface;
        setLiveSurface(next);
      } catch {
        // Ignore malformed stream payloads and keep the latest valid surface.
      }
    };
    return () => stream.close();
  }, []);

  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const release of releases) {
      const value = (release.release_type || "unknown").trim();
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value, count]) => ({
        value,
        label: value === "unknown" ? "Unknown type" : value,
        count,
      }));
  }, [releases]);

  const filtered = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return releases
      .filter((release) => {
        if (statusFilter === "detected" && release.status !== "detected")
          return false;
        if (statusFilter === "downloading" && release.status !== "downloading")
          return false;
        if (statusFilter === "downloaded" && release.status !== "downloaded")
          return false;
        if (dateFilter === "upcoming" && !isUpcomingRelease(release))
          return false;
        if (
          dateFilter === "released" &&
          (!release.release_date || isUpcomingRelease(release))
        )
          return false;
        if (dateFilter === "unknown" && release.release_date) return false;
        if (typeFilter && (release.release_type || "unknown") !== typeFilter)
          return false;
        if (!normalized) return true;
        return `${release.artist_name} ${release.album_title} ${
          release.release_type || ""
        }`
          .toLowerCase()
          .includes(normalized);
      })
      .sort(compareRadarDates);
  }, [releases, search, statusFilter, dateFilter, typeFilter]);
  const pageCount = Math.max(
    1,
    Math.ceil(filtered.length / RELEASES_PAGE_SIZE),
  );
  const currentPage = Math.min(page, pageCount);
  const visibleReleases = filtered.slice(
    (currentPage - 1) * RELEASES_PAGE_SIZE,
    currentPage * RELEASES_PAGE_SIZE,
  );

  const stats = useMemo(() => {
    const detected = releases.filter(
      (release) => release.status === "detected",
    ).length;
    const downloading = releases.filter(
      (release) => release.status === "downloading",
    ).length;
    const downloaded = releases.filter(
      (release) => release.status === "downloaded",
    ).length;
    const upcoming = releases.filter((release) =>
      isUpcomingRelease(release),
    ).length;
    return { detected, downloading, downloaded, upcoming };
  }, [releases]);

  async function checkNow() {
    setChecking(true);
    try {
      const { task_id } = await api<{ task_id: string }>(
        "/api/acquisition/new-releases/check",
        "POST",
      );
      toast.success("Checking for new releases…");
      const task = await waitForTask(task_id, 300000);
      setChecking(false);
      if (task.status === "completed") {
        toast.success("Release check complete");
        setLiveSurface(null);
        refetch();
      } else {
        toast.error(task.error || `Release check ${task.status}`);
      }
    } catch {
      setChecking(false);
      toast.error("Failed to queue the release check");
    }
  }

  async function downloadRelease(id: number) {
    try {
      await api(`/api/acquisition/new-releases/${id}/download`, "POST");
      toast.success("Download started");
      setLiveSurface((current) => ({
        releases: (current?.releases ?? releaseSurface?.releases ?? []).map(
          (release) =>
            release.id === id ? { ...release, status: "downloading" } : release,
        ),
      }));
    } catch {
      toast.error("Download failed");
    }
  }

  async function dismissRelease(id: number) {
    try {
      await api(`/api/acquisition/new-releases/${id}/dismiss`, "POST");
      setLiveSurface((current) => ({
        releases: (current?.releases ?? releaseSurface?.releases ?? []).filter(
          (release) => release.id !== id,
        ),
      }));
    } catch {
      toast.error("Dismiss failed");
    }
  }

  if (error && releases.length === 0) {
    return <ErrorState message={error} onRetry={refetch} />;
  }

  const releaseDownload = canAcquireReleases ? downloadRelease : undefined;
  const releaseDismiss = canCurateReleases ? dismissRelease : undefined;

  return (
    <div className="space-y-6">
      <OpsPageHero
        title="Release Radar"
        description="See what is coming, what has already landed, and how much of each album is in the library."
        compactActions
        actions={
          <PageHeaderActions>
            <>
              <div
                role="group"
                aria-label="Release view"
                className="flex items-center gap-1"
              >
                <PageHeaderAction
                  label="Timeline"
                  aria-pressed={view === "timeline"}
                  onClick={() => setView("timeline")}
                >
                  <HeaderList
                    data-admin-ux="header-timeline"
                    aria-hidden="true"
                  />
                </PageHeaderAction>
                <PageHeaderAction
                  label="Grid"
                  aria-pressed={view === "grid"}
                  onClick={() => setView("grid")}
                >
                  <HeaderLayoutGrid
                    data-admin-ux="header-grid"
                    aria-hidden="true"
                  />
                </PageHeaderAction>
              </div>
              {canCurateReleases ? (
                <PageHeaderAction
                  label={checking ? "Checking…" : "Check now"}
                  onClick={checkNow}
                  disabled={checking}
                  aria-busy={checking}
                >
                  {checking ? (
                    <Loader2
                      size={14}
                      className="animate-spin"
                      aria-hidden="true"
                      data-admin-ux="releases-check-loading"
                    />
                  ) : null}
                  {!checking ? (
                    <HeaderRadar
                      data-admin-ux="header-check-now"
                      aria-hidden="true"
                    />
                  ) : null}
                </PageHeaderAction>
              ) : null}
            </>
          </PageHeaderActions>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OpsStatTile
          label="Needs action"
          value={stats.detected.toLocaleString()}
          caption="Detected releases waiting for a decision"
          tone={stats.detected > 0 ? "primary" : "default"}
        />
        <OpsStatTile
          label="Downloading"
          value={stats.downloading.toLocaleString()}
          caption="Acquisition tasks in flight"
          tone={stats.downloading > 0 ? "warning" : "default"}
        />
        <OpsStatTile
          label="Downloaded"
          value={stats.downloaded.toLocaleString()}
          caption="Already landed in the library"
          tone={stats.downloaded > 0 ? "success" : "default"}
        />
        <OpsStatTile
          label="Upcoming"
          value={stats.upcoming.toLocaleString()}
          caption="Future-dated releases still on the radar"
        />
      </div>

      <OpsPanel
        title="Radar filters"
        description="Search by artist or album, then narrow the radar by acquisition state or release type."
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="crate-form-field min-w-0 flex-1">
            <label htmlFor="releases-search">
              <MonoLabel as="span">Search releases</MonoLabel>
            </label>
            <SearchInput
              id="releases-search"
              label="Search releases"
              value={search}
              onValueChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Search artist or album..."
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip
              active={statusFilter === "all"}
              onClick={() => {
                setStatusFilter("all");
                setPage(1);
              }}
            >
              All
            </FilterChip>
            <FilterChip
              active={statusFilter === "detected"}
              onClick={() => {
                setStatusFilter("detected");
                setPage(1);
              }}
            >
              Needs action
            </FilterChip>
            <FilterChip
              active={statusFilter === "downloading"}
              onClick={() => {
                setStatusFilter("downloading");
                setPage(1);
              }}
            >
              Downloading
            </FilterChip>
            <FilterChip
              active={statusFilter === "downloaded"}
              onClick={() => {
                setStatusFilter("downloaded");
                setPage(1);
              }}
            >
              Downloaded
            </FilterChip>
          </div>
          <div className="crate-form-field">
            <MonoLabel as="span">Release date</MonoLabel>
            <div
              role="group"
              aria-label="Release date"
              className="flex flex-wrap gap-2"
            >
              {[
                { value: "", label: "Any date" },
                { value: "upcoming", label: "Upcoming" },
                { value: "released", label: "Released" },
                { value: "unknown", label: "Date unknown" },
              ].map((option) => (
                <FilterChip
                  key={option.value}
                  active={dateFilter === option.value}
                  onClick={() => {
                    setDateFilter(option.value as DateFilter);
                    setPage(1);
                  }}
                >
                  {option.label}
                </FilterChip>
              ))}
            </div>
          </div>
          <label className="crate-form-field">
            <MonoLabel as="span">Release type</MonoLabel>
            <AdminSelect
              value={typeFilter}
              onChange={(value) => {
                setTypeFilter(value);
                setPage(1);
              }}
              options={typeOptions}
              placeholder="All types"
              searchable
              searchPlaceholder="Filter release types..."
              triggerClassName="min-h-11 min-w-[170px]"
            />
          </label>
        </div>
      </OpsPanel>

      <OpsPanel
        title="Releases"
        description="Triage acquisition state independently from release dates and library coverage."
      >
        {loading ? (
          <div
            role="status"
            aria-label="Loading releases"
            className="flex items-center justify-center gap-2 py-16 text-text-muted"
          >
            <Loader2
              aria-hidden="true"
              data-admin-ux="releases-loading"
              className="h-5 w-5 animate-spin text-accent-action-hi"
            />
            Loading releases
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No releases match the current radar"
            description="Try widening the filters or run a fresh release check to bring new detections into the queue."
          />
        ) : view === "timeline" ? (
          <div className="space-y-3">
            {visibleReleases.map((release) => (
              <ReleaseTimelineRow
                key={release.id}
                release={release}
                onDownload={releaseDownload}
                onDismiss={releaseDismiss}
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
            {visibleReleases.map((release) => (
              <ReleaseGridCard
                key={release.id}
                release={release}
                onDownload={releaseDownload}
                onDismiss={releaseDismiss}
              />
            ))}
          </div>
        )}
        {!loading && filtered.length > 0 ? (
          <ListPagination
            label="releases"
            itemCount={filtered.length}
            page={currentPage}
            pageSize={RELEASES_PAGE_SIZE}
            onPageChange={setPage}
          />
        ) : null}
      </OpsPanel>
    </div>
  );
}
