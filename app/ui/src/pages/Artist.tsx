import { useLibrarySearch } from "@/hooks/use-library-search";
import { useState, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useApi } from "@/hooks/use-api";
import {
  useTopTracks,
  useArtistEnrichment,
  type EnrichmentData,
} from "@/hooks/use-artist-data";
import { ArtistHeroSection } from "@/components/artist/ArtistHeroSection";
import { ArtistMetadataEditor } from "@/components/artist/ArtistMetadataEditor";
import { ArtistBioResearchDialog } from "@/components/artist/ArtistBioResearchDialog";
import { ArtistRepairDialog } from "@/components/artist/ArtistRepairDialog";
import { ArtistDiscographySection } from "@/components/artist/ArtistDiscographySection";
import { ArtistLoadingState } from "@/components/artist/ArtistLoadingState";
import { ArtistOverviewSection } from "@/components/artist/ArtistOverviewSection";
import { ArtistSetlistSection } from "@/components/artist/ArtistSetlistSection";
import {
  ArtistShowsSection,
  type ArtistShowEvent,
} from "@/components/artist/ArtistShowsSection";
import { ArtistSimilarSection } from "@/components/artist/ArtistSimilarSection";
import { ArtistStatsSection } from "@/components/artist/ArtistStatsSection";
import { ArtistTopTracksSection } from "@/components/artist/ArtistTopTracksSection";
import { ArtistArtworkSection } from "@/components/artist/ArtistArtworkSection";
import { ArtistTabsNav } from "@/components/artist/ArtistTabsNav";
import {
  buildArtistTabs,
  buildArtistTags,
  buildExternalLinks,
  buildMergedSimilarArtists,
  computePopularityScore,
} from "@/components/artist/artistPageData";
import type { ArtistData, TabKey } from "@/components/artist/artistPageTypes";
import { api } from "@/lib/api";
import { createSystemPlaylistFromBlueprint } from "@/lib/system-playlist-blueprints";
import {
  artistActionApiPath,
  artistApiPath,
  artistManagementApiPath,
  artistPagePath,
  tidalDownloadMissingArtistApiPath,
  tidalMissingArtistApiPath,
} from "@/lib/library-routes";
import { waitForTask } from "@/lib/tasks";
import { saveArtistBiography } from "@/lib/artist-biography";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { Button } from "@crate/ui/shadcn/button";
import { Badge } from "@crate/ui/shadcn/badge";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";
import { Loader2 } from "@crate/ui/icons";
import { SearchInput } from "@crate/ui/primitives/SearchInput";

interface ArtistRepairPlanSummary {
  total: number;
}

type ArtistMetadataAction = "lyrics" | "portable" | "export" | null;

interface ArtistSearchResult {
  id?: number;
  entity_uid?: string;
  slug?: string;
  name: string;
}

interface ArtistIdentity {
  artistId?: number;
  artistEntityUid?: string;
}

export async function refreshArtistProbableSetlist(
  identity: ArtistIdentity,
  refetchEnrichment: () => Promise<EnrichmentData | null>,
): Promise<{ enrichment: EnrichmentData; status: string }> {
  const endpoint = artistActionApiPath(identity, "probable-setlist/refresh");
  if (!endpoint) throw new Error("Artist reference missing");

  const queued = await api<{ task_id: string; status?: string }>(
    endpoint,
    "POST",
  );
  const task = await waitForTask(queued.task_id, 120000);
  if (task.status !== "completed") {
    throw new Error(task.error || "Probable setlist refresh failed");
  }

  const enrichment = await refetchEnrichment();
  if (!enrichment) {
    throw new Error("Setlist refreshed, but artist data could not be reloaded");
  }
  const status =
    typeof task.result?.status === "string" ? task.result.status : "ready";
  return { enrichment, status };
}

export function MergeArtistDialog({
  open,
  currentArtistId,
  currentArtistName,
  busy,
  onOpenChange,
  onMerge,
}: {
  open: boolean;
  currentArtistId?: number;
  currentArtistName: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onMerge: (artist: ArtistSearchResult) => void;
}) {
  const {
    query,
    setQuery,
    results,
    searching,
    error: searchError,
    retry: retrySearch,
  } = useLibrarySearch<ArtistSearchResult>(open, "", "artists");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display">Merge Artist Alias</DialogTitle>
          <DialogDescription>
            Move every album from {currentArtistName} into another artist and
            remove this duplicate artist row.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="crate-form-field">
            <label htmlFor="merge-artist-target" data-slot="form-field-label">
              <MonoLabel as="span">Target artist</MonoLabel>
            </label>
            <SearchInput
              id="merge-artist-target"
              label="Target artist"
              value={query}
              onValueChange={setQuery}
              placeholder="Search canonical artist"
              autoFocus
            />
          </div>

          <div className="max-h-[320px] overflow-y-auto rounded-md border border-border-quiet">
            {searchError ? (
              <ErrorState message={searchError} onRetry={retrySearch} />
            ) : searching ? (
              <div className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground">
                <Loader2
                  data-admin-ux="artist-merge-search-loading"
                  size={15}
                  className="animate-spin"
                />
                Searching artists...
              </div>
            ) : results.length ? (
              <div className="divide-y divide-border-quiet">
                {results.map((artist) => {
                  const isCurrentArtist =
                    currentArtistId != null && artist.id === currentArtistId;
                  return (
                    <button
                      key={`${artist.entity_uid || artist.id}-${artist.name}`}
                      type="button"
                      disabled={busy || isCurrentArtist || artist.id == null}
                      onClick={() => onMerge(artist)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-text-primary transition-colors hover:text-accent-action-hi focus-visible:text-accent-action-hi disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <span className="truncate text-sm font-medium">
                        {artist.name}
                      </span>
                      {isCurrentArtist ? (
                        <Badge variant="secondary">Current</Badge>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : query.trim().length >= 2 ? (
              <div className="px-4 py-5 text-sm text-muted-foreground">
                No matching artists found.
              </div>
            ) : (
              <div className="px-4 py-5 text-sm text-muted-foreground">
                Type at least 2 characters to search.
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ArtistTabContentProps {
  activeTab: TabKey;
  artistName: string;
  data: ArtistData;
  sortedAlbums: ArtistData["albums"];
  bioText: string;
  onToggleBioExpanded: () => void;
  topTracks: ReturnType<typeof useTopTracks>;
  mb: EnrichmentData["musicbrainz"];
  lastfm: EnrichmentData["lastfm"];
  spotify: EnrichmentData["spotify"];
  setlistData: EnrichmentData["setlist"];
  externalLinks: ReturnType<typeof buildExternalLinks>;
  flags: {
    bioExpanded: boolean;
    enrichmentLoading: boolean;
    canResearchBio: boolean;
    showMissing: boolean;
    downloadingDiscog: boolean;
    canDownloadTidal: boolean;
    canEditMetadata: boolean;
    refreshingSetlist: boolean;
  };
  onResearchBio: () => void;
  missingAlbums: { title: string; first_release_date: string; type: string }[];
  tidalMissing: {
    url: string;
    title: string;
    year: string;
    tracks: number;
    cover: string | null;
    quality: string;
  }[];
  sort: string;
  onToggleShowMissing: () => void;
  onSortChange: (sort: string) => void;
  onDownloadDiscography: () => void;
  allTrackTitles: {
    title: string;
    album: string;
    path: string;
    album_id?: number;
    album_slug?: string;
  }[];
  onTrackTitlesLoaded: (
    titles: {
      title: string;
      album: string;
      path: string;
      album_id?: number;
      album_slug?: string;
    }[],
  ) => void;
  onRefreshSetlist: () => void;
  mergedSimilar: ReturnType<typeof buildMergedSimilarArtists>;
  auxiliaryErrors: Partial<
    Record<"shows" | "tracks" | "missing" | "tidal", string>
  >;
  onRetryAuxiliaryData: (
    feed: "shows" | "tracks" | "missing" | "tidal",
  ) => void;
}

function ArtistTabContent({
  activeTab,
  artistName,
  data,
  sortedAlbums,
  bioText,
  onToggleBioExpanded,
  topTracks,
  mb,
  lastfm,
  spotify,
  setlistData,
  externalLinks,
  flags,
  onResearchBio,
  missingAlbums,
  tidalMissing,
  sort,
  onToggleShowMissing,
  onSortChange,
  onDownloadDiscography,
  allTrackTitles,
  onTrackTitlesLoaded,
  onRefreshSetlist,
  mergedSimilar,
  auxiliaryErrors,
  onRetryAuxiliaryData,
}: ArtistTabContentProps) {
  const {
    bioExpanded,
    enrichmentLoading,
    canResearchBio,
    showMissing,
    downloadingDiscog,
    canDownloadTidal,
    canEditMetadata,
    refreshingSetlist,
  } = flags;
  return (
    <div data-slot="artist-tab-content" className="min-w-0 pb-8 pt-4">
      {activeTab === "overview" ? (
        <ArtistOverviewSection
          bioText={bioText}
          bioExpanded={bioExpanded}
          onToggleBioExpanded={onToggleBioExpanded}
          topTracks={topTracks}
          musicbrainz={mb}
          albumCount={data.albums.length}
          totalTracks={
            data.total_tracks ??
            data.albums.reduce((sum, album) => sum + album.tracks, 0)
          }
          totalSizeMb={
            data.total_size_mb ??
            data.albums.reduce((sum, album) => sum + album.size_mb, 0)
          }
          lastfm={lastfm}
          spotify={spotify}
          externalLinks={externalLinks}
          enrichmentLoading={enrichmentLoading}
          canResearchBio={canResearchBio}
          onResearchBio={onResearchBio}
        />
      ) : null}
      {activeTab === "top-tracks" ? (
        <ArtistTopTracksSection
          topTracks={topTracks}
          spotifyTopTracks={spotify?.top_tracks}
        />
      ) : null}
      {activeTab === "discography" ? (
        <ArtistDiscographySection
          artistName={artistName}
          artistId={data.id}
          artistEntityUid={data.entity_uid}
          artistSlug={data.slug}
          albums={data.albums}
          sortedAlbums={sortedAlbums}
          missingAlbums={missingAlbums}
          tidalMissing={tidalMissing}
          showMissing={showMissing}
          sort={sort}
          downloadingDiscog={downloadingDiscog}
          canDownloadTidal={canDownloadTidal}
          onToggleShowMissing={onToggleShowMissing}
          onSortChange={onSortChange}
          onDownloadDiscography={onDownloadDiscography}
        />
      ) : null}
      {activeTab === "setlist" ? (
        <ArtistSetlistSection
          artistName={artistName}
          artistId={data.id}
          artistEntityUid={data.entity_uid}
          setlistData={setlistData}
          allTrackTitles={allTrackTitles}
          onTrackTitlesLoaded={onTrackTitlesLoaded}
          canRefresh={canEditMetadata}
          refreshing={refreshingSetlist}
          onRefresh={onRefreshSetlist}
        />
      ) : null}
      {activeTab === "shows" ? (
        <ArtistShowsSection artistName={artistName} />
      ) : null}
      {activeTab === "similar" ? (
        <ArtistSimilarSection
          artistName={artistName}
          artistId={data.id}
          artistEntityUid={data.entity_uid}
          artists={mergedSimilar}
        />
      ) : null}
      {activeTab === "stats" ? (
        <ArtistStatsSection
          artistName={artistName}
          artistId={data.id}
          artistEntityUid={data.entity_uid}
          catalogueAlbums={data.albums}
          totalTracks={data.total_tracks}
          genreProfile={data.genre_profile}
        />
      ) : null}
      {activeTab === "artwork" && data.id != null ? (
        <ArtistArtworkSection
          artistId={data.id}
          artistEntityUid={data.entity_uid}
          artistName={artistName}
          genres={data.genres}
          imageVersion={data.updated_at}
          canEdit={canEditMetadata}
        />
      ) : null}
      {(activeTab === "discography"
        ? ["missing", "tidal"]
        : activeTab === "setlist"
          ? ["tracks"]
          : activeTab === "overview" || activeTab === "shows"
            ? ["shows"]
            : []
      ).map((feed) => {
        const key = feed as keyof typeof auxiliaryErrors;
        return auxiliaryErrors[key] ? (
          <ErrorState
            key={key}
            message={auxiliaryErrors[key]}
            onRetry={() => onRetryAuxiliaryData(key)}
          />
        ) : null;
      })}
    </div>
  );
}

interface ArtistPageDialogsProps {
  data: ArtistData;
  artistName: string;
  state: {
    showDeleteConfirm: boolean;
    showRepairDialog: boolean;
    showMetadataEditor: boolean;
    showBioResearch: boolean;
    showMergeArtist: boolean;
    mergingArtist: boolean;
  };
  onDeleteDialogChange: (open: boolean) => void;
  onDelete: () => Promise<void>;
  onRepairDialogChange: (open: boolean) => void;
  setIssueCountOverride: (value: number | null) => void;
  onMetadataEditorChange: (open: boolean) => void;
  onSaved: () => void;
  onBioResearchChange: (open: boolean) => void;
  bioText: string;
  onApplyBioResearch: (proposal: string) => Promise<void>;
  onMergeArtistChange: (open: boolean) => void;
  onMergeArtist: (artist: ArtistSearchResult) => void;
}

function ArtistPageDialogs({
  data,
  artistName,
  state,
  onDeleteDialogChange,
  onDelete,
  onRepairDialogChange,
  setIssueCountOverride,
  onMetadataEditorChange,
  onSaved,
  onBioResearchChange,
  bioText,
  onApplyBioResearch,
  onMergeArtistChange,
  onMergeArtist,
}: ArtistPageDialogsProps) {
  const {
    showDeleteConfirm,
    showRepairDialog,
    showMetadataEditor,
    showBioResearch,
    showMergeArtist,
    mergingArtist,
  } = state;
  return (
    <>
      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={onDeleteDialogChange}
        title={`Delete ${data.name}?`}
        description={`This will permanently delete ${data.name} and all their albums/tracks from the database AND the filesystem. This action cannot be undone.`}
        confirmLabel="Delete Artist"
        variant="destructive"
        onConfirm={onDelete}
        onError={() => {}}
        eyebrow="Confirm action"
        consequence={`${data.albums.length} albums · ${
          data.total_tracks ??
          data.albums.reduce((sum, album) => sum + album.tracks, 0)
        } tracks · ${
          data.total_size_mb ??
          data.albums.reduce((sum, album) => sum + album.size_mb, 0)
        } MB · permanently deletes database entries and files`}
      />
      <ArtistRepairDialog
        open={showRepairDialog}
        onOpenChange={onRepairDialogChange}
        artistName={artistName}
        artistId={data.id}
        artistEntityUid={data.entity_uid}
        onIssueCountChange={setIssueCountOverride}
      />
      <ArtistMetadataEditor
        open={showMetadataEditor}
        onOpenChange={onMetadataEditorChange}
        artist={data}
        onSaved={onSaved}
      />
      <ArtistBioResearchDialog
        open={showBioResearch}
        onOpenChange={onBioResearchChange}
        artist={data}
        currentBio={bioText}
        onApply={onApplyBioResearch}
      />
      <MergeArtistDialog
        open={showMergeArtist}
        currentArtistId={data.id}
        currentArtistName={data.name}
        busy={mergingArtist}
        onOpenChange={onMergeArtistChange}
        onMerge={onMergeArtist}
      />
    </>
  );
}

async function deleteArtist(data: ArtistData) {
  try {
    const endpoint = artistManagementApiPath(
      { artistId: data.id, artistEntityUid: data.entity_uid },
      "delete",
    );
    if (!endpoint) throw new Error("artist reference missing");
    await api<{ task_id: string }>(endpoint, "POST", { mode: "full" });
    toast.success(`Deletion queued for ${data.name}`, {
      description: "The worker will delete the artist in the background.",
    });
    window.location.href = "/browse";
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Failed to queue artist deletion";
    toast.error(message);
    throw error;
  }
}

// ── Main Component ──

type ArtistMissingAlbum = {
  title: string;
  first_release_date: string;
  type: string;
};

type ArtistTidalAlbum = {
  url: string;
  title: string;
  year: string;
  tracks: number;
  cover: string | null;
  quality: string;
};

type ArtistTrackTitle = {
  title: string;
  album: string;
  path: string;
  album_id?: number;
  album_slug?: string;
};

function useArtistPageData() {
  const { artistId: artistIdParam, artistSlug } = useParams<{
    artistId?: string;
    artistSlug?: string;
  }>();
  const navigate = useNavigate();
  const parsedArtistId = artistIdParam ? Number(artistIdParam) : undefined;
  const artistId =
    parsedArtistId != null && Number.isSafeInteger(parsedArtistId)
      ? parsedArtistId
      : undefined;
  const { data, loading, error, refetch } = useApi<ArtistData>(
    artistApiPath({
      artistId,
      artistSlug: artistId == null ? artistSlug : undefined,
    }) || null,
  );
  const topTracks = useTopTracks(data?.id, data?.entity_uid);
  const {
    enrichment: fetchedEnrichment,
    loading: enrichmentLoading,
    refetch: refetchEnrichment,
  } = useArtistEnrichment(data?.id, data?.entity_uid);
  const { isAdmin, hasCapability } = useAuth();
  const canAnalyze = hasCapability("library.analysis.manage");
  const canEditMetadata = hasCapability("library.metadata.write");
  const canRepairArtist = hasCapability("library.repair.run");
  const canCreatePlaylists = hasCapability("curation.playlists.write");
  const canDownloadTidal = hasCapability("library.tidal.manage");
  const canDeleteArtist =
    hasCapability("library.artist.remove") &&
    hasCapability("library.files.delete");
  const canMergeArtist = hasCapability("library.artist.remove");
  const rawIssueCount = data?.issue_count ?? 0;
  const shouldLoadRepairPlanSummary = canRepairArtist && rawIssueCount > 0;
  const repairPlanEndpoint = shouldLoadRepairPlanSummary
    ? artistManagementApiPath(
        { artistId: data?.id, artistEntityUid: data?.entity_uid },
        "repair-plan",
      ) || null
    : null;
  const { data: repairPlanSummary } =
    useApi<ArtistRepairPlanSummary>(repairPlanEndpoint);

  useEffect(() => {
    if (artistId == null || !data?.slug) return;
    navigate(artistPagePath({ artistSlug: data.slug, artistName: data.name }), {
      replace: true,
    });
  }, [artistId, data?.slug, data?.name, navigate]);

  return {
    data,
    loading,
    error,
    refetch,
    navigate,
    topTracks,
    fetchedEnrichment,
    enrichmentLoading,
    refetchEnrichment,
    isAdmin,
    canAnalyze,
    canEditMetadata,
    canRepairArtist,
    canCreatePlaylists,
    canDownloadTidal,
    canDeleteArtist,
    canMergeArtist,
    rawIssueCount,
    repairPlanSummary,
  };
}

function useArtistPageUiState() {
  const [sort, setSort] = useState("name");
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [photoError, setPhotoError] = useState(false);
  const [photoCacheBust, setPhotoCacheBust] = useState("");
  const [bgCacheBust, setBgCacheBust] = useState("");
  const [bgLoaded, setBgLoaded] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [refreshingSetlist, setRefreshingSetlist] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [showMissing, setShowMissing] = useState(true);
  const [downloadingDiscog, setDownloadingDiscog] = useState(false);
  const [creatingCorePlaylist, setCreatingCorePlaylist] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [enrichment, setEnrichment] = useState<EnrichmentData | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [searchParams] = useSearchParams();
  const [showRepairDialog, setShowRepairDialog] = useState(
    () => searchParams.get("repair") === "1",
  );
  const [showMetadataEditor, setShowMetadataEditor] = useState(false);
  const [showBioResearch, setShowBioResearch] = useState(false);
  const [showMergeArtist, setShowMergeArtist] = useState(false);
  const [mergingArtist, setMergingArtist] = useState(false);
  const [metadataAction, setMetadataAction] =
    useState<ArtistMetadataAction>(null);
  const [issueCountOverride, setIssueCountOverride] = useState<number | null>(
    null,
  );

  return {
    sort,
    setSort,
    photoLoaded,
    setPhotoLoaded,
    photoError,
    setPhotoError,
    photoCacheBust,
    setPhotoCacheBust,
    bgCacheBust,
    setBgCacheBust,
    bgLoaded,
    setBgLoaded,
    enriching,
    setEnriching,
    refreshingSetlist,
    setRefreshingSetlist,
    activeTab,
    setActiveTab,
    showMissing,
    setShowMissing,
    downloadingDiscog,
    setDownloadingDiscog,
    creatingCorePlaylist,
    setCreatingCorePlaylist,
    bioExpanded,
    setBioExpanded,
    enrichment,
    setEnrichment,
    showDeleteConfirm,
    setShowDeleteConfirm,
    showRepairDialog,
    setShowRepairDialog,
    showMetadataEditor,
    setShowMetadataEditor,
    showBioResearch,
    setShowBioResearch,
    showMergeArtist,
    setShowMergeArtist,
    mergingArtist,
    setMergingArtist,
    metadataAction,
    setMetadataAction,
    issueCountOverride,
    setIssueCountOverride,
  };
}

function useArtistPageAuxiliaryData({
  data,
  activeTab,
}: {
  data: ArtistData | null;
  activeTab: TabKey;
}) {
  const [auxiliaryErrors, setAuxiliaryErrors] = useState<
    Partial<Record<"shows" | "tracks" | "missing" | "tidal", string>>
  >({});
  const [retryAttempts, setRetryAttempts] = useState({
    shows: 0,
    tracks: 0,
    missing: 0,
    tidal: 0,
  });
  const clearAuxiliaryError = (feed: keyof typeof retryAttempts) =>
    setAuxiliaryErrors((current) => ({ ...current, [feed]: undefined }));
  const retryAuxiliaryData = (feed: keyof typeof retryAttempts) => {
    clearAuxiliaryError(feed);
    setRetryAttempts((current) => ({ ...current, [feed]: current[feed] + 1 }));
  };
  const [upcomingShows, setUpcomingShows] = useState<ArtistShowEvent[]>([]);
  const [showsLoaded, setShowsLoaded] = useState(false);
  const [missingAlbums, setMissingAlbums] = useState<ArtistMissingAlbum[]>([]);
  const [missingLoaded, setMissingLoaded] = useState(false);
  const [tidalMissing, setTidalMissing] = useState<ArtistTidalAlbum[]>([]);
  const [tidalMissingLoaded, setTidalMissingLoaded] = useState(false);
  const [allTrackTitles, setAllTrackTitles] = useState<ArtistTrackTitle[]>([]);

  useEffect(() => {
    const endpoint = artistActionApiPath(
      { artistId: data?.id, artistEntityUid: data?.entity_uid },
      "shows",
    );
    if (!endpoint || showsLoaded) return;
    let cancelled = false;
    api<{ events: ArtistShowEvent[]; configured: boolean }>(endpoint)
      .then((payload) => {
        if (cancelled) return;
        clearAuxiliaryError("shows");
        setUpcomingShows(payload.events || []);
        setShowsLoaded(true);
      })
      .catch(() => {
        if (!cancelled)
          setAuxiliaryErrors((current) => ({
            ...current,
            shows: "Upcoming shows could not be loaded.",
          }));
      });
    return () => {
      cancelled = true;
    };
  }, [data?.entity_uid, data?.id, showsLoaded, retryAttempts.shows]);

  useEffect(() => {
    const endpoint = artistActionApiPath(
      { artistId: data?.id, artistEntityUid: data?.entity_uid },
      "track-titles",
    );
    if (!endpoint || activeTab !== "setlist" || allTrackTitles.length > 0) {
      return;
    }
    let cancelled = false;
    api<ArtistTrackTitle[]>(endpoint)
      .then((payload) => {
        if (cancelled) return;
        clearAuxiliaryError("tracks");
        if (Array.isArray(payload)) setAllTrackTitles(payload);
      })
      .catch(() => {
        if (!cancelled)
          setAuxiliaryErrors((current) => ({
            ...current,
            tracks: "Artist tracks could not be loaded.",
          }));
      });
    return () => {
      cancelled = true;
    };
  }, [
    data?.entity_uid,
    data?.id,
    activeTab,
    allTrackTitles.length,
    retryAttempts.tracks,
  ]);

  useEffect(() => {
    const endpoint = artistActionApiPath(
      { artistId: data?.id, artistEntityUid: data?.entity_uid },
      "missing",
    );
    if (!endpoint || activeTab !== "discography" || missingLoaded) return;
    let cancelled = false;
    api<{ missing: ArtistMissingAlbum[] }>(endpoint)
      .then((payload) => {
        if (cancelled) return;
        clearAuxiliaryError("missing");
        setMissingAlbums(payload.missing ?? []);
        setMissingLoaded(true);
      })
      .catch(() => {
        if (!cancelled)
          setAuxiliaryErrors((current) => ({
            ...current,
            missing: "Missing albums could not be loaded.",
          }));
      });
    return () => {
      cancelled = true;
    };
  }, [
    data?.entity_uid,
    data?.id,
    activeTab,
    missingLoaded,
    retryAttempts.missing,
  ]);

  useEffect(() => {
    const endpoint = tidalMissingArtistApiPath({
      artistId: data?.id,
      artistEntityUid: data?.entity_uid,
    });
    if (!endpoint || activeTab !== "discography" || tidalMissingLoaded) return;
    let cancelled = false;
    api<{ albums: ArtistTidalAlbum[]; authenticated: boolean }>(endpoint)
      .then((payload) => {
        if (cancelled) return;
        clearAuxiliaryError("tidal");
        if (payload.albums) setTidalMissing(payload.albums);
        setTidalMissingLoaded(true);
      })
      .catch(() => {
        if (!cancelled)
          setAuxiliaryErrors((current) => ({
            ...current,
            tidal: "Tidal missing albums could not be loaded.",
          }));
      });
    return () => {
      cancelled = true;
    };
  }, [
    data?.entity_uid,
    data?.id,
    activeTab,
    tidalMissingLoaded,
    retryAttempts.tidal,
  ]);

  return {
    auxiliaryErrors,
    retryAuxiliaryData,
    upcomingShows,
    missingAlbums,
    tidalMissing,
    setTidalMissing,
    allTrackTitles,
    setAllTrackTitles,
  };
}

type ArtistPageDataState = ReturnType<typeof useArtistPageData>;
type ArtistPageUiState = ReturnType<typeof useArtistPageUiState>;
type ArtistPageAuxiliaryState = ReturnType<typeof useArtistPageAuxiliaryData>;

function useArtistPageActions({
  data,
  navigate,
  refetch,
  refetchEnrichment,
  tidalMissing,
  setEnriching,
  setRefreshingSetlist,
  setEnrichment,
  setShowRepairDialog,
  setDownloadingDiscog,
  setTidalMissing,
  setCreatingCorePlaylist,
  setMetadataAction,
  setMergingArtist,
  setShowMergeArtist,
}: Pick<
  ArtistPageDataState,
  "data" | "navigate" | "refetch" | "refetchEnrichment"
> &
  Pick<
    ArtistPageUiState,
    | "setEnriching"
    | "setRefreshingSetlist"
    | "setEnrichment"
    | "setShowRepairDialog"
    | "setDownloadingDiscog"
    | "setCreatingCorePlaylist"
    | "setMetadataAction"
    | "setMergingArtist"
    | "setShowMergeArtist"
  > &
  Pick<ArtistPageAuxiliaryState, "tidalMissing" | "setTidalMissing">) {
  const artistName = data?.name ?? "";

  async function refreshProbableSetlist() {
    setRefreshingSetlist(true);
    try {
      const result = await refreshArtistProbableSetlist(
        { artistId: data?.id, artistEntityUid: data?.entity_uid },
        refetchEnrichment,
      );
      setEnrichment(result.enrichment);
      if (result.status === "missing") {
        toast.success("Setlist refresh completed", {
          description: "Setlist.fm returned no usable recent concerts.",
        });
      } else {
        toast.success("Probable setlist refreshed");
      }
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to refresh probable setlist",
      );
    } finally {
      setRefreshingSetlist(false);
    }
  }

  async function enrichArtist() {
    setEnriching(true);
    try {
      const endpoint = artistActionApiPath(
        { artistId: data?.id, artistEntityUid: data?.entity_uid },
        "enrich",
      );
      if (!endpoint) throw new Error("artist reference missing");
      const res = await api<{ status: string; task_id: string }>(
        endpoint,
        "POST",
      );
      toast.success("Enrichment started", {
        description: "This may take a moment...",
      });
      const task = await waitForTask(res.task_id, 120000);
      setEnriching(false);
      if (task.status === "completed") {
        toast.success("Artist enriched!");
        window.location.reload();
      } else if (task.status === "failed") {
        toast.error("Enrichment failed");
      }
    } catch {
      setEnriching(false);
      toast.error("Failed to start enrichment");
    }
  }

  async function applyBioResearchProposal(proposal: string) {
    await saveArtistBiography(
      { artistId: data?.id, artistEntityUid: data?.entity_uid },
      proposal,
    );
    refetch();
  }

  async function analyzeArtist() {
    try {
      const endpoint = artistManagementApiPath(
        { artistId: data?.id, artistEntityUid: data?.entity_uid },
        "reanalyze",
      );
      if (!endpoint) throw new Error("artist reference missing");
      await api(endpoint, "POST");
      toast.success("Analysis queued", {
        description: "Background daemons will process the tracks.",
      });
    } catch {
      toast.error("Failed to queue analysis");
    }
  }

  function repairArtist() {
    setShowRepairDialog(true);
  }

  async function downloadMissingDiscography() {
    setDownloadingDiscog(true);
    try {
      const endpoint = tidalDownloadMissingArtistApiPath({
        artistId: data?.id,
        artistEntityUid: data?.entity_uid,
      });
      if (!endpoint) throw new Error("artist reference missing");
      const res = await api<{ queued: number }>(endpoint, "POST", {
        albums: tidalMissing.map((album) => ({
          url: album.url,
          title: album.title,
          cover_url: album.cover,
        })),
      });
      toast.success(`Queued ${res.queued} albums for download`);
      setTidalMissing([]);
    } catch {
      toast.error("Failed to queue downloads");
    } finally {
      setDownloadingDiscog(false);
    }
  }

  async function createArtistCorePlaylist() {
    setCreatingCorePlaylist(true);
    try {
      const playlist = await createSystemPlaylistFromBlueprint({
        targetType: "artist",
        targetName: artistName,
        blueprintKey: "artist-essentials",
      });
      toast.success(`Created "${playlist.name}"`);
      navigate(`/playlists/${playlist.id}`);
    } catch {
      toast.error("Failed to create artist core playlist");
    } finally {
      setCreatingCorePlaylist(false);
    }
  }

  async function queueArtistMetadataAction(
    action: Exclude<ArtistMetadataAction, null>,
  ) {
    setMetadataAction(action);
    try {
      if (action === "lyrics") {
        await api("/api/manage/sync-lyrics", "POST", {
          artist: artistName,
          limit: 1000,
        });
        toast.success("Lyrics sync queued");
      } else if (action === "portable") {
        await api("/api/manage/portable-metadata", "POST", {
          artist: artistName,
          write_audio_tags: true,
          write_sidecars: true,
        });
        toast.success("Portable metadata queued");
      } else {
        await api("/api/manage/portable-metadata/export-rich", "POST", {
          artist: artistName,
          include_audio: false,
          write_rich_tags: false,
        });
        toast.success("Rich metadata export queued");
      }
    } catch {
      toast.error("Failed to queue metadata task");
    } finally {
      setMetadataAction(null);
    }
  }

  async function mergeArtistInto(targetArtist: ArtistSearchResult) {
    if (!data || targetArtist.id == null) return;
    const endpoint = artistManagementApiPath(
      { artistId: data.id, artistEntityUid: data.entity_uid },
      "merge",
    );
    if (!endpoint) {
      toast.error("Artist reference missing");
      return;
    }

    setMergingArtist(true);
    try {
      const { task_id } = await api<{ task_id: string }>(endpoint, "POST", {
        target_artist_id: targetArtist.id,
        reason: "Manual artist alias merge from admin artist view",
      });
      toast.success("Artist merge queued");
      const task = await waitForTask(task_id, 120000);
      if (task.status === "completed") {
        toast.success("Artist alias merged");
        setShowMergeArtist(false);
        navigate(
          artistPagePath({
            artistSlug: targetArtist.slug,
            artistName: targetArtist.name,
          }),
        );
      } else {
        toast.error(task.error || "Artist merge failed");
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to merge artist";
      toast.error(message);
    } finally {
      setMergingArtist(false);
    }
  }

  return {
    refreshProbableSetlist,
    enrichArtist,
    applyBioResearchProposal,
    analyzeArtist,
    repairArtist,
    downloadMissingDiscography,
    createArtistCorePlaylist,
    queueArtistMetadataAction,
    mergeArtistInto,
  };
}

function useArtistPageModel() {
  const dataState = useArtistPageData();
  const uiState = useArtistPageUiState();
  useEffect(() => {
    if (dataState.fetchedEnrichment) {
      uiState.setEnrichment(dataState.fetchedEnrichment as EnrichmentData);
    }
  }, [dataState.fetchedEnrichment, uiState.setEnrichment]);
  const auxiliaryState = useArtistPageAuxiliaryData({
    data: dataState.data,
    activeTab: uiState.activeTab,
  });
  const actionState = useArtistPageActions({
    data: dataState.data,
    navigate: dataState.navigate,
    refetch: dataState.refetch,
    refetchEnrichment: dataState.refetchEnrichment,
    tidalMissing: auxiliaryState.tidalMissing,
    setEnriching: uiState.setEnriching,
    setRefreshingSetlist: uiState.setRefreshingSetlist,
    setEnrichment: uiState.setEnrichment,
    setShowRepairDialog: uiState.setShowRepairDialog,
    setDownloadingDiscog: uiState.setDownloadingDiscog,
    setTidalMissing: auxiliaryState.setTidalMissing,
    setCreatingCorePlaylist: uiState.setCreatingCorePlaylist,
    setMetadataAction: uiState.setMetadataAction,
    setMergingArtist: uiState.setMergingArtist,
    setShowMergeArtist: uiState.setShowMergeArtist,
  });

  if (dataState.loading) return { loading: true as const, data: null };
  if (!dataState.data) {
    return {
      loading: false as const,
      data: null,
      error: dataState.error,
      refetch: dataState.refetch,
    };
  }

  const {
    data,
    topTracks,
    enrichmentLoading,
    isAdmin,
    canAnalyze,
    canEditMetadata,
    canRepairArtist,
    canCreatePlaylists,
    canDownloadTidal,
    canDeleteArtist,
    canMergeArtist,
    rawIssueCount,
    repairPlanSummary,
    refetch,
  } = dataState;
  const {
    sort,
    photoLoaded,
    photoError,
    photoCacheBust,
    bgCacheBust,
    bgLoaded,
    enriching,
    refreshingSetlist,
    activeTab,
    showMissing,
    downloadingDiscog,
    creatingCorePlaylist,
    bioExpanded,
    enrichment,
    showDeleteConfirm,
    showRepairDialog,
    showMetadataEditor,
    showBioResearch,
    showMergeArtist,
    mergingArtist,
    metadataAction,
  } = uiState;
  const { upcomingShows, missingAlbums, tidalMissing, allTrackTitles } =
    auxiliaryState;

  const artistName = data.name;
  const totalTracks =
    data.total_tracks ??
    data.albums.reduce((sum, album) => sum + album.tracks, 0);
  const totalSize =
    data.total_size_mb ??
    data.albums.reduce((sum, album) => sum + album.size_mb, 0);
  const letter = artistName.charAt(0).toUpperCase();
  const issueCount =
    uiState.issueCountOverride ?? repairPlanSummary?.total ?? rawIssueCount;
  const showRepairAction = canRepairArtist && issueCount > 0;
  const sortedAlbums = [...data.albums].sort((a, b) => {
    if (sort === "year") return (b.year || "").localeCompare(a.year || "");
    if (sort === "tracks") return b.tracks - a.tracks;
    return a.name.localeCompare(b.name);
  });
  const bioText =
    data.bio !== null && data.bio !== undefined
      ? data.bio
      : (enrichment?.lastfm?.bio ?? "");
  const mb = enrichment?.musicbrainz;
  const spotify = enrichment?.spotify;
  const lastfm = enrichment?.lastfm;
  const setlistData = enrichment?.setlist;
  const allTags = buildArtistTags(data.genres, enrichment);
  const mergedSimilar = buildMergedSimilarArtists(enrichment);
  const externalLinks = buildExternalLinks(enrichment);
  const tabs = buildArtistTabs(upcomingShows.length);
  const popularityScore =
    data.popularity_score != null
      ? Math.round(data.popularity_score * 100)
      : computePopularityScore(spotify?.popularity, lastfm?.listeners);

  return {
    loading: false as const,
    data,
    artistName,
    totalTracks,
    totalSize,
    letter,
    issueCount,
    showRepairAction,
    sortedAlbums,
    bioText,
    mb,
    spotify,
    lastfm,
    setlistData,
    allTags,
    mergedSimilar,
    tabs,
    popularityScore,
    topTracks,
    externalLinks,
    upcomingShows,
    missingAlbums,
    tidalMissing,
    allTrackTitles,
    showMissing,
    downloadingDiscog,
    sort,
    activeTab,
    bioExpanded,
    enrichmentLoading,
    canDownloadTidal,
    canEditMetadata,
    canCreatePlaylists,
    canRepairArtist,
    canDeleteArtist,
    canMergeArtist,
    isAdmin,
    canAnalyze,
    enriching,
    refreshingSetlist,
    creatingCorePlaylist,
    photoLoaded,
    photoError,
    photoCacheBust,
    bgCacheBust,
    bgLoaded,
    metadataAction,
    showDeleteConfirm,
    showRepairDialog,
    showMetadataEditor,
    showBioResearch,
    showMergeArtist,
    mergingArtist,
    setBgLoaded: uiState.setBgLoaded,
    setBgCacheBust: uiState.setBgCacheBust,
    setPhotoLoaded: uiState.setPhotoLoaded,
    setPhotoError: uiState.setPhotoError,
    setPhotoCacheBust: uiState.setPhotoCacheBust,
    setActiveTab: uiState.setActiveTab,
    setBioExpanded: uiState.setBioExpanded,
    setShowMissing: uiState.setShowMissing,
    setSort: uiState.setSort,
    setAllTrackTitles: auxiliaryState.setAllTrackTitles,
    auxiliaryErrors: auxiliaryState.auxiliaryErrors,
    retryAuxiliaryData: auxiliaryState.retryAuxiliaryData,
    setShowDeleteConfirm: uiState.setShowDeleteConfirm,
    setShowRepairDialog: uiState.setShowRepairDialog,
    setShowMetadataEditor: uiState.setShowMetadataEditor,
    setShowBioResearch: uiState.setShowBioResearch,
    setShowMergeArtist: uiState.setShowMergeArtist,
    setIssueCountOverride: uiState.setIssueCountOverride,
    refetch,
    refreshProbableSetlist: actionState.refreshProbableSetlist,
    enrichArtist: actionState.enrichArtist,
    analyzeArtist: actionState.analyzeArtist,
    createArtistCorePlaylist: actionState.createArtistCorePlaylist,
    repairArtist: actionState.repairArtist,
    downloadMissingDiscography: actionState.downloadMissingDiscography,
    queueArtistMetadataAction: actionState.queueArtistMetadataAction,
    applyBioResearchProposal: actionState.applyBioResearchProposal,
    mergeArtistInto: actionState.mergeArtistInto,
  };
}
function ArtistPageView({ model }: { model: ArtistPageReadyModel }) {
  const {
    data,
    artistName,
    totalTracks,
    totalSize,
    letter,
    issueCount,
    showRepairAction,
    sortedAlbums,
    bioText,
    mb,
    spotify,
    lastfm,
    setlistData,
    allTags,
    mergedSimilar,
    tabs,
    popularityScore,
    topTracks,
    externalLinks,
    upcomingShows,
    missingAlbums,
    tidalMissing,
    allTrackTitles,
    showMissing,
    downloadingDiscog,
    sort,
    activeTab,
    bioExpanded,
    enrichmentLoading,
    canDownloadTidal,
    canEditMetadata,
    canCreatePlaylists,
    canRepairArtist,
    canDeleteArtist,
    canMergeArtist,
    isAdmin,
    canAnalyze,
    enriching,
    refreshingSetlist,
    creatingCorePlaylist,
    photoLoaded,
    photoError,
    photoCacheBust,
    bgCacheBust,
    bgLoaded,
    metadataAction,
    showDeleteConfirm,
    showRepairDialog,
    showMetadataEditor,
    showBioResearch,
    showMergeArtist,
    mergingArtist,
    setBgLoaded,
    setBgCacheBust,
    setPhotoLoaded,
    setPhotoError,
    setPhotoCacheBust,
    setActiveTab,
    setBioExpanded,
    setShowMissing,
    setSort,
    setAllTrackTitles,
    setShowDeleteConfirm,
    setShowRepairDialog,
    setShowMetadataEditor,
    setShowBioResearch,
    setShowMergeArtist,
    setIssueCountOverride,
    refetch,
    refreshProbableSetlist,
    enrichArtist,
    analyzeArtist,
    createArtistCorePlaylist,
    repairArtist,
    downloadMissingDiscography,
    queueArtistMetadataAction,
    applyBioResearchProposal,
    mergeArtistInto,
  } = model;
  return (
    <div className="min-w-0 space-y-6">
      <ArtistHeroSection
        artistName={artistName}
        artistId={data.id}
        artistEntityUid={data.entity_uid}
        artistSlug={data.slug}
        imageVersion={data.updated_at}
        letter={letter}
        albumCount={data.albums.length}
        totalTracks={totalTracks}
        totalSizeMb={totalSize}
        issueCount={issueCount}
        showRepairAction={showRepairAction}
        musicbrainz={mb}
        lastfmListeners={lastfm?.listeners}
        upcomingShow={upcomingShows[0]}
        popularityScore={popularityScore}
        genreProfile={data.genre_profile}
        tags={allTags}
        enriching={enriching}
        isAdmin={isAdmin}
        canEditArtwork={canEditMetadata}
        canEnrich={canEditMetadata}
        canAnalyze={canAnalyze}
        canEditMetadata={canEditMetadata}
        canCreateCorePlaylist={canCreatePlaylists}
        canQueueMetadata={canEditMetadata}
        canRepair={canRepairArtist}
        canDelete={canDeleteArtist}
        canMerge={canMergeArtist}
        photoLoaded={photoLoaded}
        photoError={photoError}
        photoCacheBust={photoCacheBust}
        bgCacheBust={bgCacheBust}
        bgLoaded={bgLoaded}
        onBackgroundLoad={() => setBgLoaded(true)}
        onPhotoLoad={() => setPhotoLoaded(true)}
        onPhotoError={() => setPhotoError(true)}
        onBackgroundUploaded={() => {
          setBgLoaded(false);
          setBgCacheBust(String(Date.now()));
        }}
        onPhotoUploaded={() => {
          setPhotoError(false);
          setPhotoLoaded(false);
          setPhotoCacheBust(String(Date.now()));
        }}
        onEnrich={() => void enrichArtist()}
        onAnalyze={() => void analyzeArtist()}
        corePlaylistCreating={creatingCorePlaylist}
        onCreateCorePlaylist={
          canCreatePlaylists && totalTracks > 0
            ? () => void createArtistCorePlaylist()
            : undefined
        }
        onRepair={() => void repairArtist()}
        onEditMetadata={() => setShowMetadataEditor(true)}
        metadataAction={metadataAction}
        onSyncLyrics={() => void queueArtistMetadataAction("lyrics")}
        onWritePortableMetadata={() =>
          void queueArtistMetadataAction("portable")
        }
        onExportRichMetadata={() => void queueArtistMetadataAction("export")}
        onDelete={() => setShowDeleteConfirm(true)}
        onMerge={() => setShowMergeArtist(true)}
      />
      <ArtistTabsNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab}>
        <ArtistTabContent
          activeTab={activeTab}
          artistName={artistName}
          data={data}
          sortedAlbums={sortedAlbums}
          bioText={bioText}
          onToggleBioExpanded={() => setBioExpanded(!bioExpanded)}
          topTracks={topTracks}
          mb={mb}
          lastfm={lastfm}
          spotify={spotify}
          setlistData={setlistData}
          externalLinks={externalLinks}
          flags={{
            bioExpanded,
            enrichmentLoading,
            canResearchBio: canEditMetadata,
            showMissing,
            downloadingDiscog,
            canDownloadTidal,
            canEditMetadata,
            refreshingSetlist,
          }}
          onResearchBio={() => setShowBioResearch(true)}
          missingAlbums={missingAlbums}
          tidalMissing={tidalMissing}
          sort={sort}
          onToggleShowMissing={() => setShowMissing(!showMissing)}
          onSortChange={setSort}
          onDownloadDiscography={() => void downloadMissingDiscography()}
          allTrackTitles={allTrackTitles}
          onTrackTitlesLoaded={setAllTrackTitles}
          onRefreshSetlist={() => void refreshProbableSetlist()}
          mergedSimilar={mergedSimilar}
          auxiliaryErrors={model.auxiliaryErrors}
          onRetryAuxiliaryData={model.retryAuxiliaryData}
        />
      </ArtistTabsNav>
      <ArtistPageDialogs
        data={data}
        artistName={artistName}
        state={{
          showDeleteConfirm,
          showRepairDialog,
          showMetadataEditor,
          showBioResearch,
          showMergeArtist,
          mergingArtist,
        }}
        onDeleteDialogChange={setShowDeleteConfirm}
        onDelete={() => deleteArtist(data)}
        onRepairDialogChange={setShowRepairDialog}
        setIssueCountOverride={setIssueCountOverride}
        onMetadataEditorChange={setShowMetadataEditor}
        onSaved={refetch}
        onBioResearchChange={setShowBioResearch}
        bioText={bioText}
        onApplyBioResearch={applyBioResearchProposal}
        onMergeArtistChange={setShowMergeArtist}
        onMergeArtist={(artist) => void mergeArtistInto(artist)}
      />
    </div>
  );
}

type ArtistPageReadyModel = Extract<
  ReturnType<typeof useArtistPageModel>,
  { data: ArtistData }
>;

function ArtistRouteContent() {
  const model = useArtistPageModel();
  if (model.loading) return <ArtistLoadingState />;
  if (model.error && !model.data) {
    return (
      <ErrorState
        variant="page"
        kind="error"
        title="Artist unavailable"
        message="This artist could not be loaded. Try again or return to Browse."
        onRetry={model.refetch}
        backTo="/browse"
        backLabel="Browse artists"
      />
    );
  }
  if (!model.data) {
    return (
      <ErrorState
        variant="page"
        kind="notFound"
        title="Artist not found"
        message="This artist is not available in the catalog."
        backTo="/browse"
        backLabel="Browse artists"
      />
    );
  }
  return <ArtistPageView model={model} />;
}

// Route identity owns the full artist model, including auxiliary reads and drafts.
export function Artist() {
  const { artistId, artistSlug } = useParams();
  return <ArtistRouteContent key={artistId ?? artistSlug ?? "missing"} />;
}
