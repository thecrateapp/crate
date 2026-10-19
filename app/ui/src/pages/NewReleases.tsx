import { EventDate } from "@/components/ui/EventDate";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { FilterChip } from "@crate/ui/primitives/FilterChip";
import {
  PageHeaderAction,
  PageHeaderActions,
} from "@/components/layout/PageHeader";
import {
  List as HeaderList,
  LayoutGrid as HeaderLayoutGrid,
  Radar as HeaderRadar,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import {
  OpsPageHero,
  OpsPanel,
  OpsStatTile,
} from "@/components/admin/ops-surfaces";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { Button } from "@crate/ui/shadcn/button";

import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { Input } from "@crate/ui/shadcn/input";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { api, apiSseUrl } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";
import { waitForTask } from "@/lib/tasks";
import { useApi } from "@/hooks/use-api";
import { timeAgo } from "@/lib/utils";

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
  tracks: number;
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
type StatusFilter =
  | "all"
  | "detected"
  | "downloading"
  | "downloaded"
  | "upcoming";

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

function releaseDateValue(release: Release) {
  return release.release_date || release.detected_at?.slice(0, 10) || "";
}

function isUpcomingRelease(release: Release) {
  const date = release.release_date;
  if (!date) return false;
  return date >= new Date().toISOString().slice(0, 10);
}

function ReleaseDateBadge({ release }: { release: Release }) {
  return (
    <EventDate
      date={releaseDateValue(release)}
      labelPrefix={release.release_date ? undefined : "Detected"}
    />
  );
}

function ReleaseMeta({ release }: { release: Release }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-white/40">
      {release.release_type ? (
        <InfoBadge>{release.release_type}</InfoBadge>
      ) : null}
      {release.quality ? (
        <InfoBadge className="border-accent-action/25 bg-accent-action/10 text-accent-action-hi">
          {release.quality}
        </InfoBadge>
      ) : null}
      {release.year ? <InfoBadge>{release.year}</InfoBadge> : null}
      {release.tracks > 0 ? (
        <InfoBadge>{release.tracks} tracks</InfoBadge>
      ) : null}
      <InfoBadge>{timeAgo(release.detected_at)}</InfoBadge>
    </div>
  );
}

function ReleaseActions({
  release,
  onDownload,
  onDismiss,
}: {
  release: Release;
  onDownload?: (id: number) => void;
  onDismiss?: (id: number) => void;
}) {
  if (release.status === "downloaded") {
    return (
      <InfoBadge className="border-accent-action/25 bg-accent-action/10 text-accent-action-hi">
        Downloaded
      </InfoBadge>
    );
  }
  if (release.status === "downloading") {
    return (
      <InfoBadge active>
        <Loader2
          aria-hidden="true"
          data-admin-ux="releases-download-loading"
          size={12}
          className="animate-spin"
        />
        Downloading
      </InfoBadge>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {release.tidal_url && onDownload ? (
        <Button
          size="sm"
          className="min-h-11 gap-2"
          onClick={() => onDownload(release.id)}
        >
          Download
        </Button>
      ) : null}
      {onDismiss ? (
        <Button
          variant="outline"
          size="icon"
          onClick={() => onDismiss(release.id)}
          title="Dismiss release"
          aria-label="Dismiss release"
          className="h-11 min-h-11 w-11 min-w-11 md:min-h-11 md:min-w-11"
        >
          <X
            size={15}
            aria-hidden="true"
            data-admin-ux="releases-timeline-dismiss"
          />
        </Button>
      ) : null}
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
  const artistHref = releaseArtistHref(release);
  const albumHref = releaseAlbumHref(release);

  return (
    <div className="group flex flex-col gap-3 rounded-md border border-white/8 bg-black/15 p-4 transition-colors hover:border-white/14  xl:flex-row xl:items-center">
      <div className="flex items-center gap-4 xl:w-[320px] xl:flex-shrink-0">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-white/8 bg-white/[0.03]">
          <ReleaseDateBadge release={release} />
        </div>
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-white/8 bg-white/[0.04]">
          {release.cover_url ? (
            <img
              src={release.cover_url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center"></div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {albumHref ? (
            <Link
              to={albumHref}
              className="block truncate text-base font-semibold tracking-tight text-white transition-colors hover:text-primary"
            >
              {release.album_title}
            </Link>
          ) : (
            <div className="truncate text-base font-semibold tracking-tight text-white">
              {release.album_title}
            </div>
          )}
          {artistHref ? (
            <Link
              to={artistHref}
              className="text-sm text-white/45 transition-colors hover:text-white/80"
            >
              {release.artist_name}
            </Link>
          ) : (
            <div className="text-sm text-white/45">{release.artist_name}</div>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <ReleaseMeta release={release} />
        <div className="text-sm text-white/35">
          {isUpcomingRelease(release)
            ? "Upcoming release on the radar"
            : "Detected by the release monitor and ready for acquisition triage"}
        </div>
      </div>

      <div className="flex items-center xl:justify-end">
        <ReleaseActions
          release={release}
          onDownload={onDownload}
          onDismiss={onDismiss}
        />
      </div>
    </div>
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
    <div className="group overflow-hidden rounded-md border border-white/8 bg-black/20 shadow-[0_16px_36px_rgba(0,0,0,0.16)]">
      <div className="relative aspect-square bg-white/[0.04]">
        {release.cover_url ? (
          <img
            src={release.cover_url}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center"></div>
        )}

        <div className="absolute left-3 top-3">
          {release.status === "detected" ? (
            <InfoBadge active>Detected</InfoBadge>
          ) : null}
          {release.status === "downloading" ? (
            <InfoBadge active>Downloading</InfoBadge>
          ) : null}
          {release.status === "downloaded" ? (
            <InfoBadge className="border-accent-action/25 bg-accent-action/10 text-accent-action-hi">
              Downloaded
            </InfoBadge>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div className="space-y-1">
          {albumHref ? (
            <Link
              to={albumHref}
              className="block truncate text-sm font-semibold text-white transition-colors hover:text-primary"
            >
              {release.album_title}
            </Link>
          ) : (
            <div className="truncate text-sm font-semibold text-white">
              {release.album_title}
            </div>
          )}
          {artistHref ? (
            <Link
              to={artistHref}
              className="block truncate text-xs text-white/45 transition-colors hover:text-white/80"
            >
              {release.artist_name}
            </Link>
          ) : (
            <div className="truncate text-xs text-white/45">
              {release.artist_name}
            </div>
          )}
        </div>

        <ReleaseMeta release={release} />

        <div className="flex items-center gap-2">
          {release.status === "detected" && release.tidal_url && onDownload ? (
            <Button
              size="sm"
              className="min-h-11 flex-1 gap-2"
              onClick={() => onDownload(release.id)}
            >
              Download
            </Button>
          ) : null}
          {release.status === "detected" && onDismiss ? (
            <Button
              variant="outline"
              size="icon"
              onClick={() => onDismiss(release.id)}
              title="Dismiss release"
              aria-label="Dismiss release"
              className="h-11 min-h-11 w-11 min-w-11 md:min-h-11 md:min-w-11"
            >
              <X
                size={15}
                aria-hidden="true"
                data-admin-ux="releases-grid-dismiss"
              />
            </Button>
          ) : null}
        </div>
      </div>
    </div>
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
    <div className="rounded-md border border-dashed border-white/10 bg-black/15 px-4 py-16 text-center">
      <div className="text-lg font-semibold text-white/80">{title}</div>
      <div className="mx-auto mt-2 max-w-xl text-sm text-white/40">
        {description}
      </div>
    </div>
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
  const [typeFilter, setTypeFilter] = useState("");
  const [view, setView] = useState<ViewMode>("timeline");
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
        if (statusFilter === "upcoming" && !isUpcomingRelease(release))
          return false;
        if (typeFilter && (release.release_type || "unknown") !== typeFilter)
          return false;
        if (!normalized) return true;
        return `${release.artist_name} ${release.album_title} ${
          release.release_type || ""
        }`
          .toLowerCase()
          .includes(normalized);
      })
      .sort((a, b) => releaseDateValue(b).localeCompare(releaseDateValue(a)));
  }, [releases, search, statusFilter, typeFilter]);

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
        title="New Releases"
        description="Release radar for library artists, with quick triage for what should land next in Crate."
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
      >
        <InfoBadge active>{releases.length} total</InfoBadge>
        <InfoBadge>{stats.detected} need action</InfoBadge>
        <InfoBadge>{stats.downloading} downloading</InfoBadge>
        <InfoBadge>{stats.downloaded} in library</InfoBadge>
        <InfoBadge>{stats.upcoming} upcoming</InfoBadge>
      </OpsPageHero>

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
            <div className="relative">
              <Search
                aria-hidden="true"
                data-admin-ux="releases-search"
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
              />
              <Input
                id="releases-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search artist or album..."
                className="min-h-11 pl-9"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip
              className="min-h-11"
              active={statusFilter === "all"}
              onClick={() => setStatusFilter("all")}
            >
              All
            </FilterChip>
            <FilterChip
              className="min-h-11"
              active={statusFilter === "detected"}
              onClick={() => setStatusFilter("detected")}
            >
              Needs action
            </FilterChip>
            <FilterChip
              className="min-h-11"
              active={statusFilter === "downloading"}
              onClick={() => setStatusFilter("downloading")}
            >
              Downloading
            </FilterChip>
            <FilterChip
              className="min-h-11"
              active={statusFilter === "downloaded"}
              onClick={() => setStatusFilter("downloaded")}
            >
              Downloaded
            </FilterChip>
            <FilterChip
              className="min-h-11"
              active={statusFilter === "upcoming"}
              onClick={() => setStatusFilter("upcoming")}
            >
              Upcoming
            </FilterChip>
          </div>
          <label className="crate-form-field">
            <MonoLabel as="span">Release type</MonoLabel>
            <AdminSelect
              value={typeFilter}
              onChange={setTypeFilter}
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
        title="Release radar"
        description="Use timeline when you want to triage in date order, or grid when you need a visual scan of artwork and release types."
      >
        {loading ? (
          <div
            role="status"
            aria-label="Loading releases"
            className="flex items-center justify-center gap-2 py-16 text-white/45"
          >
            <Loader2
              aria-hidden="true"
              data-admin-ux="releases-loading"
              className="h-5 w-5 animate-spin text-primary"
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
            {filtered.map((release) => (
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
            {filtered.map((release) => (
              <ReleaseGridCard
                key={release.id}
                release={release}
                onDownload={releaseDownload}
                onDismiss={releaseDismiss}
              />
            ))}
          </div>
        )}
      </OpsPanel>
    </div>
  );
}
