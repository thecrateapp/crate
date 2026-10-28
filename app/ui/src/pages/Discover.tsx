import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import {
  PageHeaderAction,
  PageHeaderActions,
} from "@/components/layout/PageHeader";
import {
  RefreshCw as HeaderRefreshCw,
  ChartNoAxesCombined as HeaderChartNoAxesCombined,
  Radar as HeaderRadar,
  Loader2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  OpsPageHero,
  OpsPanel,
  OpsRefreshNotice,
  OpsSurface,
  OpsStatTile,
} from "@/components/admin/ops-surfaces";
import { Button } from "@crate/ui/shadcn/button";

import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { MediaCover } from "@crate/ui/domain/media/MediaCover";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { useTaskPoll } from "@/hooks/use-task-poll";
import { api } from "@/lib/api";
import {
  artistPagePath,
  artistPhotoApiUrl,
  albumPagePath,
} from "@/lib/library-routes";
import { cn, formatCompact } from "@/lib/utils";
import { SearchInput } from "@crate/ui/primitives/SearchInput";

interface MissingAlbum {
  title: string;
  type: string;
  year: string;
}

interface ArtistCompleteness {
  artist: string;
  artist_id?: number;
  artist_entity_uid?: string;
  artist_slug?: string;
  has_photo: boolean;
  listeners: number;
  local_count: number;
  mb_count: number;
  pct: number;
  missing: MissingAlbum[];
}

interface Release {
  id: number;
  artist_name: string;
  artist_id?: number;
  artist_slug?: string;
  album_title: string;
  album_id?: number;
  album_slug?: string;
  release_date: string | null;
  release_type: string | null;
  cover_url: string | null;
  status: string;
  tracks: number;
  quality: string;
}

interface InsightsData {
  popularity: { artist: string; popularity: number; listeners: number }[];
  top_albums: {
    album: string;
    artist: string;
    listeners: number;
    popularity: number;
    year: string | null;
  }[];
  top_genres: { genre: string; artists: number; albums: number }[];
  completeness: {
    artists_total: number;
    artists_with_photo: number;
    artists_enriched: number;
    albums_total: number;
    albums_with_cover: number;
    tracks_total: number;
    tracks_analyzed: number;
  };
}

function completionTone(pct: number) {
  if (pct >= 100) return "bg-accent-action";
  if (pct > 75) return "bg-accent-action";
  if (pct > 50) return "bg-state-warning";
  return "bg-state-warning";
}

function OpportunityCard({
  artist,
  canAcquire,
}: {
  artist: ArtistCompleteness;
  canAcquire: boolean;
}) {
  const navigate = useNavigate();
  const href =
    artist.artist_id != null || artist.artist_slug || artist.artist
      ? artistPagePath({
          artistId: artist.artist_id,
          artistSlug: artist.artist_slug,
          artistName: artist.artist,
        })
      : undefined;

  return (
    <OpsSurface className="p-4">
      <div className="flex items-start gap-3">
        <MediaCover
          src={artistPhotoApiUrl({
            artistId: artist.artist_id,
            artistEntityUid: artist.artist_entity_uid,
            artistSlug: artist.artist_slug,
            artistName: artist.artist,
          })}
          alt={artist.artist}
          size={56}
          className="border border-border-quiet"
        />

        <div className="min-w-0 flex-1 space-y-2">
          <div className="space-y-1">
            {href ? (
              <Link
                to={href}
                className="block truncate text-base font-semibold tracking-tight text-text-primary transition-colors hover:text-accent-action-hi"
              >
                {artist.artist}
              </Link>
            ) : (
              <div className="truncate text-base font-semibold tracking-tight text-text-primary">
                {artist.artist}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-subtle">
              <InfoBadge>
                {artist.local_count}/{artist.mb_count} releases
              </InfoBadge>
              <InfoBadge>{artist.missing.length} missing</InfoBadge>
              {artist.listeners > 0 ? (
                <InfoBadge>
                  {formatCompact(artist.listeners)} listeners
                </InfoBadge>
              ) : null}
            </div>
          </div>

          <div className="space-y-1">
            <div
              data-admin-ux="discovery-coverage-progress"
              className="h-px overflow-hidden rounded-full bg-border-quiet"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width,background-color]",
                  completionTone(artist.pct),
                )}
                style={{ width: `${Math.min(artist.pct, 100)}%` }}
              />
            </div>
            <div className="text-xs text-text-subtle">
              {Math.round(artist.pct)}% discography coverage
            </div>
          </div>

          {artist.missing.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {artist.missing.slice(0, 3).map((album) => (
                <InfoBadge key={`${artist.artist}-${album.title}`}>
                  {album.year || "?"} · {album.title}
                </InfoBadge>
              ))}
              {artist.missing.length > 3 ? (
                <InfoBadge>+{artist.missing.length - 3} more</InfoBadge>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {href ? (
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => navigate(href)}
          >
            Open artist
          </Button>
        ) : null}
        {canAcquire ? (
          <Button
            size="sm"
            className="gap-2"
            onClick={() =>
              navigate(`/download?q=${encodeURIComponent(artist.artist)}`)
            }
          >
            Acquire missing
          </Button>
        ) : null}
      </div>
    </OpsSurface>
  );
}

function ReleaseRadarRow({ release }: { release: Release }) {
  const albumHref =
    release.album_id != null
      ? albumPagePath({
          albumId: release.album_id,
          albumSlug: release.album_slug,
          artistName: release.artist_name,
          albumName: release.album_title,
        })
      : undefined;
  const artistHref =
    release.artist_id != null
      ? artistPagePath({
          artistId: release.artist_id,
          artistSlug: release.artist_slug,
          artistName: release.artist_name,
        })
      : undefined;

  return (
    <div className="flex items-center gap-3 rounded-md border border-border-quiet bg-raised-surface px-3 py-3">
      <MediaCover
        src={release.cover_url}
        alt=""
        size={48}
        className="border border-border-quiet"
      />
      <div className="min-w-0 flex-1">
        {albumHref ? (
          <Link
            to={albumHref}
            className="block truncate text-sm font-medium text-text-primary transition-colors hover:text-accent-action-hi"
          >
            {release.album_title}
          </Link>
        ) : (
          <div className="truncate text-sm font-medium text-text-primary">
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
      <div className="hidden shrink-0 md:block">
        <InfoBadge>{release.release_type || "release"}</InfoBadge>
      </div>
    </div>
  );
}

function PopularityRow({
  label,
  value,
  secondary,
}: {
  label: string;
  value: string;
  secondary?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border-quiet bg-raised-surface px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-text-primary">
          {label}
        </div>
        {secondary ? (
          <div className="truncate text-xs text-text-subtle">{secondary}</div>
        ) : null}
      </div>
      <div className="shrink-0 text-xs font-medium text-text-secondary">
        {value}
      </div>
    </div>
  );
}

function DiscoveryFeedNotice({
  label,
  loading,
  error,
  hasData,
  onRetry,
}: {
  label: string;
  loading: boolean;
  error: string | null;
  hasData: boolean;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <OpsRefreshNotice
        message={
          hasData
            ? `${label} could not refresh. Showing the last available data.`
            : `${label} could not be loaded. Other discovery data remains available.`
        }
        onRetry={onRetry}
        className="mb-4"
      />
    );
  }

  if (loading && !hasData) {
    return (
      <div
        role="status"
        aria-label={`Loading ${label.toLowerCase()}`}
        aria-busy="true"
        className="mb-4 flex min-h-11 items-center gap-3 rounded-md border border-border-quiet bg-panel-surface px-4 py-3 text-sm text-text-muted"
      >
        <Loader2
          data-admin-ux="discover-block-loading"
          aria-hidden="true"
          className="h-4 w-4 animate-spin text-accent-action-hi"
        />
        Loading {label.toLowerCase()}…
      </div>
    );
  }

  return null;
}

type DiscoveryFeed = {
  loading: boolean;
  error: string | null;
  hasData: boolean;
  retry: () => void;
};

interface DiscoverViewProps {
  canCheckReleases: boolean;
  canAcquire: boolean;
  canViewRadar: boolean;
  navigate: (to: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  recomputing: boolean;
  completenessTaskId: string | null;
  checking: boolean;
  refreshAll: () => void;
  recomputeCompleteness: () => Promise<void>;
  checkReleases: () => Promise<void>;
  summary: {
    totalArtists: number;
    incompleteArtists: number;
    detectedReleases: number;
    opportunityArtists: number;
  };
  opportunityArtists: ArtistCompleteness[];
  detectedReleases: Release[];
  genreOpportunities: InsightsData["top_genres"];
  trendingArtists: InsightsData["popularity"];
  momentumAlbums: InsightsData["top_albums"];
  feeds: {
    completeness: DiscoveryFeed;
    releases: DiscoveryFeed;
    insights: DiscoveryFeed;
  };
}

function DiscoverView({
  canCheckReleases,
  canAcquire,
  canViewRadar,
  navigate,
  search,
  onSearchChange,
  recomputing,
  completenessTaskId,
  checking,
  refreshAll,
  recomputeCompleteness,
  checkReleases,
  summary,
  opportunityArtists,
  detectedReleases,
  genreOpportunities,
  trendingArtists,
  momentumAlbums,
  feeds,
}: DiscoverViewProps) {
  return (
    <div className="space-y-6">
      <OpsPageHero
        title="Discovery"
        description="A workspace for finding what to import next: incomplete artist catalogues, fresh releases, momentum signals and genres worth expanding."
        compactActions
        actions={
          <PageHeaderActions>
            <>
              <PageHeaderAction label="Refresh" onClick={refreshAll}>
                <HeaderRefreshCw
                  data-admin-ux="header-refresh"
                  aria-hidden="true"
                />
              </PageHeaderAction>
              <PageHeaderAction
                label={
                  recomputing || completenessTaskId !== null
                    ? "Recomputing..."
                    : "Recompute gaps"
                }
                onClick={recomputeCompleteness}
                aria-busy={recomputing || completenessTaskId !== null}
                disabled={recomputing || completenessTaskId !== null}
              >
                {(recomputing || completenessTaskId !== null) && (
                  <Loader2
                    data-admin-ux="discovery-recompute-loading"
                    aria-hidden="true"
                    size={14}
                    className="animate-spin"
                  />
                )}
                {!(recomputing || completenessTaskId !== null) ? (
                  <HeaderChartNoAxesCombined
                    data-admin-ux="header-recompute-gaps"
                    aria-hidden="true"
                  />
                ) : null}
              </PageHeaderAction>
              {canCheckReleases ? (
                <PageHeaderAction
                  label="Check releases"
                  onClick={checkReleases}
                  aria-busy={checking}
                  disabled={checking}
                >
                  {checking && (
                    <Loader2
                      data-admin-ux="discovery-check-loading"
                      aria-hidden="true"
                      size={14}
                      className="animate-spin"
                    />
                  )}
                  {!checking ? (
                    <HeaderRadar
                      data-admin-ux="header-check-releases"
                      aria-hidden="true"
                    />
                  ) : null}
                </PageHeaderAction>
              ) : null}
            </>
          </PageHeaderActions>
        }
      >
        {Object.values(feeds).some((feed) => feed.loading) ? (
          <InfoBadge>Refreshing discovery</InfoBadge>
        ) : null}
        {feeds.completeness.error ? (
          <InfoBadge tone="warning">Catalogue gaps unavailable</InfoBadge>
        ) : null}
        {feeds.releases.error ? (
          <InfoBadge tone="warning">Release radar unavailable</InfoBadge>
        ) : null}
        {feeds.insights.error ? (
          <InfoBadge tone="warning">Momentum data unavailable</InfoBadge>
        ) : null}
      </OpsPageHero>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OpsStatTile
          label="Acquisition targets"
          value={
            feeds.completeness.hasData
              ? summary.opportunityArtists.toLocaleString()
              : "—"
          }
          caption={
            feeds.completeness.hasData
              ? "Artists with missing catalogue worth filling"
              : "Catalogue gaps are not available"
          }
          tone={summary.opportunityArtists > 0 ? "primary" : "default"}
        />
        <OpsStatTile
          label="Detected releases"
          value={
            feeds.releases.hasData
              ? summary.detectedReleases.toLocaleString()
              : "—"
          }
          caption={
            feeds.releases.hasData
              ? "Albums already found by the radar"
              : "Release radar data is not available"
          }
          tone={summary.detectedReleases > 0 ? "success" : "default"}
        />
        <OpsStatTile
          label="Incomplete artists"
          value={
            feeds.completeness.hasData
              ? summary.incompleteArtists.toLocaleString()
              : "—"
          }
          caption={
            feeds.completeness.hasData
              ? `${summary.totalArtists.toLocaleString()} artists scanned for catalogue gaps`
              : "Catalogue coverage is not available"
          }
          tone={summary.incompleteArtists > 0 ? "warning" : "default"}
        />
        <OpsStatTile
          label="Trend signals"
          value={
            feeds.insights.hasData
              ? (
                  trendingArtists.length + momentumAlbums.length
                ).toLocaleString()
              : "—"
          }
          caption={
            feeds.insights.hasData
              ? "Popularity and momentum slices from the library orbit"
              : "Popularity signals are not available"
          }
        />
      </div>

      <OpsPanel
        title="Search workspace"
        description="Narrow all discovery panels at once by artist, album or missing-release title."
      >
        <div className="crate-form-field">
          <label htmlFor="discovery-search">
            <MonoLabel as="span">Search discovery</MonoLabel>
          </label>
          <SearchInput
            id="discovery-search"
            label="Search discovery"
            value={search}
            onValueChange={onSearchChange}
            placeholder="Search artists, releases or missing albums..."
          />
        </div>
      </OpsPanel>

      <OpsPanel
        title="Acquisition opportunities"
        description="Artists with enough listener weight and enough missing catalogue to justify a download or curation pass."
      >
        <DiscoveryFeedNotice
          label="Catalogue gaps"
          loading={feeds.completeness.loading}
          error={feeds.completeness.error}
          hasData={feeds.completeness.hasData}
          onRetry={feeds.completeness.retry}
        />
        {opportunityArtists.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {opportunityArtists.slice(0, 8).map((artist) => (
              <OpportunityCard
                key={artist.artist}
                artist={artist}
                canAcquire={canAcquire}
              />
            ))}
          </div>
        ) : feeds.completeness.hasData ||
          (!feeds.completeness.loading && !feeds.completeness.error) ? (
          <div className="rounded-md border border-dashed border-border-quiet px-4 py-12 text-center text-sm text-text-subtle">
            No acquisition opportunities match the current filter.
          </div>
        ) : null}
      </OpsPanel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <OpsPanel
          title="Release Radar"
          description="Freshly detected albums from your orbit that may deserve immediate acquisition."
          action={
            canViewRadar ? (
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => navigate("/new-releases")}
              >
                Open Release Radar
              </Button>
            ) : undefined
          }
        >
          <DiscoveryFeedNotice
            label="Release Radar"
            loading={feeds.releases.loading}
            error={feeds.releases.error}
            hasData={feeds.releases.hasData}
            onRetry={feeds.releases.retry}
          />
          {detectedReleases.length > 0 ? (
            <div className="space-y-2">
              {detectedReleases.slice(0, 8).map((release) => (
                <ReleaseRadarRow key={release.id} release={release} />
              ))}
            </div>
          ) : feeds.releases.hasData ||
            (!feeds.releases.loading && !feeds.releases.error) ? (
            <div className="rounded-md border border-dashed border-border-quiet px-4 py-10 text-center text-sm text-text-subtle">
              No detected releases available right now.
            </div>
          ) : null}
        </OpsPanel>

        <OpsPanel
          title="Genres to expand"
          description="Top genres in your library, useful for spotting where a discovery sweep would most naturally fit."
        >
          <DiscoveryFeedNotice
            label="Momentum signals"
            loading={feeds.insights.loading}
            error={feeds.insights.error}
            hasData={feeds.insights.hasData}
            onRetry={feeds.insights.retry}
          />
          {genreOpportunities.length > 0 ? (
            <div className="space-y-2">
              {genreOpportunities.map((genre) => (
                <PopularityRow
                  key={genre.genre}
                  label={genre.genre}
                  value={`${genre.artists} artists`}
                  secondary={`${genre.albums} albums`}
                />
              ))}
            </div>
          ) : feeds.insights.hasData ||
            (!feeds.insights.loading && !feeds.insights.error) ? (
            <div className="rounded-md border border-dashed border-border-quiet px-4 py-10 text-center text-sm text-text-subtle">
              Genre expansion data is not available yet.
            </div>
          ) : null}
        </OpsPanel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <OpsPanel
          title="Artist momentum"
          description="Popularity leaders in your orbit. Not discovery by itself, but a strong hint for what deserves deeper acquisition."
        >
          {trendingArtists.length > 0 ? (
            <div className="space-y-2">
              {trendingArtists.map((artist) => (
                <PopularityRow
                  key={artist.artist}
                  label={artist.artist}
                  value={`${artist.popularity || 0}%`}
                  secondary={
                    artist.listeners
                      ? `${formatCompact(artist.listeners)} listeners`
                      : undefined
                  }
                />
              ))}
            </div>
          ) : feeds.insights.hasData ||
            (!feeds.insights.loading && !feeds.insights.error) ? (
            <div className="rounded-md border border-dashed border-border-quiet px-4 py-10 text-center text-sm text-text-subtle">
              No momentum data available yet.
            </div>
          ) : null}
        </OpsPanel>

        <OpsPanel
          title="Album momentum"
          description="Albums already resonating in your world. Handy for deciding which artists deserve more catalogue depth."
        >
          {momentumAlbums.length > 0 ? (
            <div className="space-y-2">
              {momentumAlbums.map((album) => (
                <PopularityRow
                  key={`${album.artist}-${album.album}`}
                  label={`${album.artist} · ${album.album}`}
                  value={
                    album.listeners
                      ? formatCompact(album.listeners)
                      : `${album.popularity || 0}%`
                  }
                  secondary={album.year || undefined}
                />
              ))}
            </div>
          ) : feeds.insights.hasData ||
            (!feeds.insights.loading && !feeds.insights.error) ? (
            <div className="rounded-md border border-dashed border-border-quiet px-4 py-10 text-center text-sm text-text-subtle">
              No album momentum data available yet.
            </div>
          ) : null}
        </OpsPanel>
      </div>
    </div>
  );
}

export function Discover() {
  const { hasCapability, hasAnyCapability } = useAuth();
  const navigate = useNavigate();
  const { pollTask } = useTaskPoll();
  const [search, setSearch] = useState("");
  const [recomputing, setRecomputing] = useState(false);
  const [completenessTaskId, setCompletenessTaskId] = useState<string | null>(
    null,
  );
  const [checking, setChecking] = useState(false);

  const {
    data: completeness,
    loading: completenessLoading,
    error: completenessError,
    refetch: refetchCompleteness,
  } = useApi<ArtistCompleteness[]>("/api/discover/completeness");

  const {
    data: releaseData,
    loading: releasesLoading,
    error: releasesError,
    refetch: refetchReleases,
  } = useApi<{ releases: Release[] }>(
    "/api/acquisition/new-releases?status=detected",
  );

  const {
    data: insights,
    loading: insightsLoading,
    error: insightsError,
    refetch: refetchInsights,
  } = useApi<InsightsData>("/api/insights");

  const normalizedSearch = search.trim().toLowerCase();

  const opportunityArtists = useMemo(() => {
    const source = completeness ?? [];
    return source
      .filter((artist) => {
        if (artist.pct >= 100 || artist.missing.length === 0) return false;
        if (!normalizedSearch) return true;
        return `${artist.artist} ${artist.missing
          .map((album) => album.title)
          .join(" ")}`
          .toLowerCase()
          .includes(normalizedSearch);
      })
      .sort((a, b) => {
        if ((b.listeners || 0) !== (a.listeners || 0))
          return (b.listeners || 0) - (a.listeners || 0);
        return a.pct - b.pct;
      });
  }, [completeness, normalizedSearch]);

  const detectedReleases = useMemo(() => {
    const source = releaseData?.releases ?? [];
    return source.filter((release) => {
      if (!normalizedSearch) return true;
      return `${release.artist_name} ${release.album_title}`
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [normalizedSearch, releaseData?.releases]);

  const trendingArtists = useMemo(() => {
    const source = insights?.popularity ?? [];
    return source
      .filter(
        (row) =>
          !normalizedSearch ||
          row.artist.toLowerCase().includes(normalizedSearch),
      )
      .slice(0, 8);
  }, [insights?.popularity, normalizedSearch]);

  const momentumAlbums = useMemo(() => {
    const source = insights?.top_albums ?? [];
    return source
      .filter(
        (row) =>
          !normalizedSearch ||
          `${row.artist} ${row.album}`.toLowerCase().includes(normalizedSearch),
      )
      .slice(0, 8);
  }, [insights?.top_albums, normalizedSearch]);

  const genreOpportunities = useMemo(
    () => (insights?.top_genres ?? []).slice(0, 8),
    [insights?.top_genres],
  );

  const summary = useMemo(() => {
    const totalArtists = completeness?.length ?? 0;
    const incompleteArtists = (completeness ?? []).filter(
      (artist) => artist.pct < 100,
    ).length;
    return {
      totalArtists,
      incompleteArtists,
      detectedReleases: releaseData?.releases?.length ?? 0,
      opportunityArtists: opportunityArtists.length,
    };
  }, [completeness, opportunityArtists.length, releaseData?.releases?.length]);

  async function refreshAll() {
    refetchCompleteness();
    refetchReleases();
    refetchInsights();
  }

  async function recomputeCompleteness() {
    setRecomputing(true);
    try {
      const { task_id: taskId } = await api<{ task_id: string }>(
        "/api/discover/completeness/refresh",
        "POST",
      );
      setCompletenessTaskId(taskId);
      pollTask(
        taskId,
        (result) => {
          setCompletenessTaskId(null);
          if (result?.finalization_skipped || result?.cache_written === false) {
            toast.error("Completeness refresh finished with failed chunks");
            return;
          }
          refetchCompleteness();
          if (result?.partial) {
            const failedArtists = Number(result.failed_artists || 0);
            toast.warning(
              `Completeness refreshed with ${failedArtists} artists skipped`,
            );
          } else {
            toast.success("Completeness refresh completed");
          }
        },
        (error) => {
          setCompletenessTaskId(null);
          toast.error(error || "Completeness refresh failed");
        },
        3000,
        30 * 60 * 1000,
      );
      toast.success("Completeness refresh queued");
    } catch {
      toast.error("Failed to queue completeness refresh");
    } finally {
      setRecomputing(false);
    }
  }

  async function checkReleases() {
    setChecking(true);
    try {
      await api("/api/acquisition/new-releases/check", "POST");
      toast.success("New release check queued");
    } catch {
      toast.error("Failed to queue release check");
    } finally {
      setChecking(false);
    }
  }

  const loading = completenessLoading && releasesLoading && insightsLoading;
  const hardError =
    !completeness &&
    completenessError &&
    !releaseData &&
    releasesError &&
    !insights &&
    insightsError;

  if (hardError) {
    return (
      <ErrorState
        message="Failed to build discovery workspace"
        onRetry={refreshAll}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-text-muted">
        <Loader2
          data-admin-ux="discovery-loading"
          aria-hidden="true"
          className="h-5 w-5 animate-spin text-accent-action-hi"
        />
      </div>
    );
  }

  return (
    <DiscoverView
      navigate={navigate}
      canCheckReleases={hasCapability("curation.releases.write")}
      canAcquire={hasAnyCapability([
        "library.import.manage",
        "library.tidal.manage",
      ])}
      canViewRadar={hasAnyCapability([
        "curation.releases.write",
        "library.tidal.manage",
      ])}
      search={search}
      onSearchChange={setSearch}
      recomputing={recomputing}
      completenessTaskId={completenessTaskId}
      checking={checking}
      refreshAll={() => void refreshAll()}
      recomputeCompleteness={recomputeCompleteness}
      checkReleases={checkReleases}
      summary={summary}
      opportunityArtists={opportunityArtists}
      detectedReleases={detectedReleases}
      genreOpportunities={genreOpportunities}
      trendingArtists={trendingArtists}
      momentumAlbums={momentumAlbums}
      feeds={{
        completeness: {
          loading: completenessLoading,
          error: completenessError,
          hasData: completeness !== null,
          retry: refetchCompleteness,
        },
        releases: {
          loading: releasesLoading,
          error: releasesError,
          hasData: releaseData !== null,
          retry: refetchReleases,
        },
        insights: {
          loading: insightsLoading,
          error: insightsError,
          hasData: insights !== null,
          retry: refetchInsights,
        },
      }}
    />
  );
}
