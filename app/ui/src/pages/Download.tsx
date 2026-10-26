import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  CRATE_ICON_SIZE,
  Download as DownloadActionIcon,
  Heart as HeartIcon,
  Loader2,
  Trash2,
  ArrowUp,
  ArrowLeft,
  ListOrdered as List,
} from "@crate/ui/icons";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import {
  OpsPageHero,
  OpsSurface,
  OpsRefreshNotice,
} from "@/components/admin/ops-surfaces";
import {
  useState,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useSyncExternalStore,
} from "react";
import { useSearchParams } from "react-router";

import { Button } from "@crate/ui/shadcn/button";
import { Badge } from "@crate/ui/shadcn/badge";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";
import { api, apiSseUrl } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { toast } from "sonner";
import { EntityAvatar } from "@crate/ui/domain/entity";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
// encPath available if needed for navigation

interface TidalAlbum {
  id: string;
  title: string;
  artist: string;
  year: string;
  tracks: number;
  cover: string | null;
  url: string;
  quality: string[];
  type?: string;
}

interface TidalTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  url: string;
  quality: string[];
}

interface TidalArtist {
  id: string;
  name: string;
  picture: string | null;
}

interface SearchResult {
  albums?: TidalAlbum[];
  artists?: TidalArtist[];
  tracks?: TidalTrack[];
}

interface SoulseekResult {
  username: string;
  speed: number;
  freeSlot: boolean;
  album: string;
  artist: string;
  files: {
    filename: string;
    size: number;
    length: number;
    extension: string;
    bitDepth?: number;
    sampleRate?: number;
  }[];
  quality: string;
  totalSize: number;
}

async function downloadFromSoulseek(result: SoulseekResult): Promise<void> {
  try {
    await api("/api/acquisition/download", "POST", {
      source: "soulseek",
      username: result.username,
      artist: result.artist,
      album: result.album,
      files: result.files,
    });
    toast.success(
      `Downloading from Soulseek: ${result.artist} - ${result.album}`,
    );
  } catch {
    toast.error("Failed to start download");
  }
}

interface QueueItem {
  id: number;
  tidal_url: string;
  title: string;
  artist: string;
  status: string;
  source: string;
  quality: string;
  cover_url: string | null;
  created_at: string;
}

interface SoulseekQueueItem {
  source: string;
  artist: string;
  album: string;
  filename: string;
  fullPath?: string;
  status: string;
  progress: number;
  username: string;
  speed: number;
}

interface AcquisitionSurface {
  tidal_authenticated: boolean;
  tidal_queue: QueueItem[];
  soulseek_queue: SoulseekQueueItem[];
}

interface ArtistSuggestionSupporter {
  user_id?: number | null;
  name?: string | null;
  email?: string | null;
  avatar?: string | null;
  note?: string | null;
  artist_url?: string | null;
  created_at?: string | null;
}

interface ArtistSuggestion {
  id: number;
  artist_name: string;
  artist_url?: string | null;
  note?: string | null;
  status: string;
  created_by_name?: string | null;
  created_by_email?: string | null;
  created_by_avatar?: string | null;
  supporter_count: number;
  supporters?: ArtistSuggestionSupporter[];
  created_at?: string | null;
  updated_at?: string | null;
}

interface ArtistSuggestionsPayload {
  suggestions: ArtistSuggestion[];
}

// Cover lookup cache — fetches from Last.fm public API (no auth needed)
const _coverCache = new Map<string, string | null>();
const _coverListeners = new Map<string, Set<() => void>>();
const _coverRequests = new Set<string>();
const _coverLookups = new Map<string, { artist: string; album: string }>();

function getCachedAlbumCover(key: string): string | null {
  return _coverCache.get(key) ?? null;
}

function notifyAlbumCover(key: string): void {
  _coverListeners.get(key)?.forEach((listener) => listener());
}

function subscribeToAlbumCover(key: string, listener: () => void): () => void {
  const listeners = _coverListeners.get(key) ?? new Set<() => void>();
  listeners.add(listener);
  _coverListeners.set(key, listeners);
  if (!_coverCache.has(key) && !_coverRequests.has(key)) {
    _coverRequests.add(key);
    const lookup = _coverLookups.get(key);
    if (!lookup) return () => undefined;
    void loadLastFmAlbumCover(lookup.artist, lookup.album)
      .then((d) => {
        const images = d?.album?.image ?? [];
        const large =
          images.find((i) => i.size === "extralarge") ??
          images[images.length - 1];
        _coverCache.set(key, large?.["#text"] || null);
      })
      .catch(() => {
        _coverCache.set(key, null);
      })
      .finally(() => {
        _coverRequests.delete(key);
        notifyAlbumCover(key);
      });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) _coverListeners.delete(key);
  };
}

function useAlbumCover(artist: string, album: string): string | null {
  const key = `${artist}|||${album}`.toLowerCase();
  _coverLookups.set(key, { artist, album });
  return useSyncExternalStore(
    (listener) => {
      if (!artist || !album) return () => undefined;
      return subscribeToAlbumCover(key, listener);
    },
    () => getCachedAlbumCover(key),
    () => null,
  );
}

async function loadLastFmAlbumCover(
  artist: string,
  album: string,
): Promise<{
  album?: { image?: Array<{ size?: string; "#text"?: string }> };
} | null> {
  const { api_key: apiKey } = await api<{ api_key?: string }>(
    "/api/auth/scrobble/lastfm/auth-url",
  );
  if (!apiKey) return null;
  const response = await fetch(
    `https://ws.audioscrobbler.com/2.0/?method=album.getinfo&api_key=${apiKey}&artist=${encodeURIComponent(
      artist,
    )}&album=${encodeURIComponent(album)}&format=json`,
  );
  if (!response.ok) {
    throw new Error(`Last.fm request failed: ${response.status}`);
  }
  return response.json();
}

// ── Quality helpers ─────────────────────────────────────────────

/** Normalize Tidal quality tags to {label, tier} for display */
function normalizeQualityTags(
  tags: string[],
): { label: string; tier: "hi-res" | "lossless" | "high" | "standard" }[] {
  if (!tags?.length) return [];
  const upper = tags.map((t) => t.toUpperCase());
  const result: {
    label: string;
    tier: "hi-res" | "lossless" | "high" | "standard";
  }[] = [];
  if (upper.includes("HIRES_LOSSLESS"))
    result.push({ label: "Hi-Res 24bit", tier: "hi-res" });
  else if (upper.includes("LOSSLESS"))
    result.push({ label: "FLAC 16/44.1", tier: "lossless" });
  else if (upper.includes("MQA"))
    result.push({ label: "MQA", tier: "lossless" });
  else if (upper.includes("HIGH"))
    result.push({ label: "AAC 320", tier: "high" });
  else result.push({ label: tags[0] ?? "Unknown", tier: "standard" });
  return result;
}

/** Tidal quality tags → numeric tier for comparison (higher = better) */
function qualityTier(tags: string[]): number {
  if (!tags?.length) return 0;
  const upper = tags.map((t) => t.toUpperCase());
  if (upper.includes("HIRES_LOSSLESS")) return 3; // 24-bit hi-res
  if (upper.includes("LOSSLESS")) return 2; // 16/44.1 CD
  if (upper.includes("MQA")) return 2;
  if (upper.includes("HIGH")) return 1; // lossy high
  return 0;
}

/** Local quality → numeric tier */
function localQualityTier(lq: {
  format?: string;
  bit_depth?: number;
  sample_rate?: number;
}): number {
  if (!lq?.format) return 0;
  const fmt = (lq.format || "").toLowerCase();
  if (fmt === "flac" || fmt === "alac" || fmt === "wav") {
    if ((lq.bit_depth || 0) > 16 || (lq.sample_rate || 0) > 48000) return 3; // hi-res
    return 2; // CD lossless
  }
  if (fmt === "mp3" || fmt === "aac" || fmt === "ogg" || fmt === "opus")
    return 1;
  return 0;
}

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Session persistence helpers — survive navigation, cleared on tab close
const STORE_KEY = "crate:acquisition:search";
function loadSession(): {
  query: string;
  results: SearchResult | null;
  soulseek: SoulseekResult[] | null;
  tab: "tidal" | "soulseek";
} {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { query: "", results: null, soulseek: null, tab: "tidal" };
}
function saveSession(data: {
  query: string;
  results: SearchResult | null;
  soulseek: SoulseekResult[] | null;
  tab: "tidal" | "soulseek";
}) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

export function DownloadPage() {
  const [searchParams] = useSearchParams();
  const initialQ = searchParams.get("q") ?? "";
  const session = loadSession();
  const [query, setQuery] = useState(initialQ || session.query);
  const [results, setResults] = useState<SearchResult | null>(session.results);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [soulseekError, setSoulseekError] = useState<string | null>(null);
  const searchGeneration = useRef(0);
  const searchController = useRef<AbortController | null>(null);
  const [queueBusy, setQueueBusy] = useState<Set<number>>(new Set());
  const queueBusyRef = useRef(new Set<number>());
  const [quality, setQuality] = useState("max");
  const [activeDownloads, setActiveDownloads] = useState<Set<string>>(
    new Set(),
  );
  const [soulseekResults, setSoulseekResults] = useState<
    SoulseekResult[] | null
  >(session.soulseek);
  const [searchingSlsk, setSearchingSlsk] = useState(false);
  const [, setSlskSearchId] = useState<string | null>(null);
  const slskStreamRef = useRef<EventSource | null>(null);
  const [resultTab, setResultTab] = useState<"tidal" | "soulseek">(session.tab);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadTaskId, setUploadTaskId] = useState<string | null>(null);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const [browsingArtist, setBrowsingArtist] = useState<{
    id: string;
    name: string;
    picture: string | null;
  } | null>(null);
  const {
    data: acquisitionSurface,
    loading: acquisitionLoading,
    error: acquisitionError,
    refetch: refetchAcquisitionSurface,
  } = useApi<AcquisitionSurface>("/api/acquisition/snapshot");
  const {
    data: artistSuggestions,
    loading: suggestionsLoading,
    error: suggestionsError,
    refetch: refetchArtistSuggestions,
  } = useApi<ArtistSuggestionsPayload>("/api/acquisition/artist-suggestions");
  const [liveAcquisitionSurface, setLiveAcquisitionSurface] =
    useState<AcquisitionSurface | null>(null);

  const currentAcquisitionSurface =
    liveAcquisitionSurface ?? acquisitionSurface ?? null;
  const tidalQueue = currentAcquisitionSurface?.tidal_queue ?? [];
  const slskQueue = currentAcquisitionSurface?.soulseek_queue ?? [];
  const tidalAuthenticated =
    currentAcquisitionSurface?.tidal_authenticated ?? null;

  // Merged queue
  const queue = tidalQueue;
  const slskDownloads = slskQueue.filter((d) => d.source === "soulseek");
  function refetchQueue() {
    refetchAcquisitionSurface();
  }
  const suggestions = artistSuggestions?.suggestions ?? [];

  // Persist search state across navigation
  useEffect(() => {
    saveSession({ query, results, soulseek: soulseekResults, tab: resultTab });
  }, [query, results, soulseekResults, resultTab]);

  useEffect(() => {
    setLiveAcquisitionSurface(acquisitionSurface);
  }, [acquisitionSurface]);

  useEffect(() => {
    const stream = new EventSource(apiSseUrl("/api/acquisition/stream"));
    stream.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as AcquisitionSurface;
        setLiveAcquisitionSurface(payload);
      } catch {
        // Ignore malformed acquisition frames and keep the stream alive.
      }
    };
    return () => {
      stream.close();
    };
  }, []);

  const doSearch = useCallback(
    async (q?: string) => {
      const term = (q ?? query).trim();
      if (term.length < 2) return;
      const generation = ++searchGeneration.current;
      searchController.current?.abort();
      const controller = new AbortController();
      searchController.current = controller;
      const current = () =>
        generation === searchGeneration.current && !controller.signal.aborted;
      slskStreamRef.current?.close();
      slskStreamRef.current = null;
      setResults(null);
      setSoulseekResults(null);
      setSearchError(null);
      setSoulseekError(null);
      setSearching(true);
      setSearchingSlsk(term.length >= 3);
      setSlskSearchId(null);
      if (term.length >= 3) {
        void api<{ search_id: string }>(
          "/api/acquisition/search/soulseek",
          "POST",
          { query: term },
          { signal: controller.signal },
        )
          .then((data) => {
            if (!current()) return;
            if (!data.search_id)
              throw new Error("Missing Soulseek search identity");
            setSlskSearchId(data.search_id);
            const stream = new EventSource(
              apiSseUrl(
                `/api/acquisition/search/soulseek/${data.search_id}/stream`,
              ),
            );
            slskStreamRef.current = stream;
            stream.onmessage = (event) => {
              if (!current()) return;
              try {
                const payload = JSON.parse(event.data) as {
                  results: SoulseekResult[];
                  isComplete: boolean;
                };
                setSoulseekResults(payload.results);
                if (payload.isComplete) {
                  setSearchingSlsk(false);
                  stream.close();
                  if (slskStreamRef.current === stream)
                    slskStreamRef.current = null;
                }
              } catch {
                /* Wait for the next valid frame. */
              }
            };
            stream.onerror = () => {
              stream.close();
              if (!current()) return;
              setSearchingSlsk(false);
              setSoulseekError(
                "Could not refresh Soulseek results. Retry the search.",
              );
              if (slskStreamRef.current === stream)
                slskStreamRef.current = null;
            };
          })
          .catch(() => {
            if (current()) {
              setSoulseekError("Could not search Soulseek. Retry the search.");
              setSearchingSlsk(false);
            }
          });
      }
      try {
        const data = await api<SearchResult>(
          `/api/tidal/search?q=${encodeURIComponent(term)}&limit=20`,
          "GET",
          undefined,
          { signal: controller.signal },
        );
        if (current()) setResults(data);
      } catch {
        if (current())
          setSearchError(
            "Could not search Tidal. Check authentication and retry.",
          );
      } finally {
        if (current()) setSearching(false);
      }
    },
    [query],
  );

  const doSearchEvent = useEffectEvent(doSearch);

  async function searchArtistSuggestion(suggestion: ArtistSuggestion) {
    const term = suggestion.artist_name.trim();
    if (!term) return;
    setQuery(term);
    setResultTab("tidal");
    void doSearch(term);
    try {
      await api(
        `/api/acquisition/artist-suggestions/${suggestion.id}`,
        "PATCH",
        {
          status: "searching",
        },
      );
      refetchArtistSuggestions();
    } catch {
      // Searching should not be blocked if triage state cannot be updated.
    }
  }

  async function updateArtistSuggestionStatus(
    suggestion: ArtistSuggestion,
    status: string,
  ) {
    try {
      await api(
        `/api/acquisition/artist-suggestions/${suggestion.id}`,
        "PATCH",
        {
          status,
        },
      );
      toast.success(
        status === "dismissed" ? "Suggestion dismissed" : "Suggestion updated",
      );
      refetchArtistSuggestions();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update suggestion",
      );
    }
  }

  // Auto-search on mount if URL has ?q=
  useEffect(() => {
    if (initialQ) doSearchEvent(initialQ);
    return () => {
      searchGeneration.current += 1;
      searchController.current?.abort();
      slskStreamRef.current?.close();
      slskStreamRef.current = null;
    };
  }, [initialQ]);

  async function startDownload(
    url: string,
    title: string,
    source = "search",
    upgradeAlbumId?: number,
  ) {
    setActiveDownloads((prev) => new Set(prev).add(url));
    try {
      const body: Record<string, unknown> = { url, quality, source, title };
      if (upgradeAlbumId) body.upgrade_album_id = upgradeAlbumId;
      await api("/api/tidal/download", "POST", body);
      toast.success(
        upgradeAlbumId ? `Upgrade queued: ${title}` : `Queued: ${title}`,
      );
      refetchQueue();
    } catch {
      toast.error("Failed to queue download");
    } finally {
      setActiveDownloads((prev) => {
        const s = new Set(prev);
        s.delete(url);
        return s;
      });
    }
  }

  async function addToWishlist(item: {
    url: string;
    tidal_id: string;
    title: string;
    artist: string;
    cover_url?: string | null;
    content_type?: string;
  }) {
    try {
      await api("/api/tidal/wishlist", "POST", { ...item, quality });
      toast.success(`Wishlisted: ${item.title}`);
      refetchQueue();
    } catch {
      toast.error("Failed to add to wishlist");
    }
  }

  async function removeQueueItem(id: number) {
    if (queueBusyRef.current.has(id)) return;
    queueBusyRef.current.add(id);
    setQueueBusy(new Set(queueBusyRef.current));
    try {
      await api(`/api/tidal/queue/${id}`, "DELETE");
      refetchQueue();
    } catch {
      toast.error("Could not remove the acquisition item. Retry the action.");
    } finally {
      queueBusyRef.current.delete(id);
      setQueueBusy(new Set(queueBusyRef.current));
    }
  }

  async function promoteWishlist(id: number, quiet = false) {
    if (queueBusyRef.current.has(id)) return false;
    queueBusyRef.current.add(id);
    setQueueBusy(new Set(queueBusyRef.current));
    try {
      await api(`/api/tidal/queue/${id}`, "PUT", { status: "queued" });
      setLiveAcquisitionSurface((current) => {
        const surface = current ?? acquisitionSurface;
        return surface
          ? {
              ...surface,
              tidal_queue: surface.tidal_queue.map((item) =>
                item.id === id ? { ...item, status: "queued" } : item,
              ),
            }
          : current;
      });
      if (!quiet) toast.success("Moved to download queue");
      refetchQueue();
      return true;
    } catch {
      if (!quiet)
        toast.error(
          "Could not queue the wishlist item. It remains in Wishlist.",
        );
      return false;
    } finally {
      queueBusyRef.current.delete(id);
      setQueueBusy(new Set(queueBusyRef.current));
    }
  }

  async function promoteAllWishlist() {
    const results = await Promise.all(
      wishlist.map((item) => promoteWishlist(item.id, true)),
    );
    const queued = results.filter(Boolean).length;
    const failed = results.length - queued;
    if (failed)
      toast.error(
        `${queued} queued · ${failed} failed. Failed items remain in Wishlist.`,
      );
    else toast.success(`${queued} wishlist items moved to download queue`);
  }

  async function submitUpload() {
    if (uploadFiles.length === 0) return;
    const formData = new FormData();
    for (const file of uploadFiles) {
      formData.append("files", file);
    }
    setUploading(true);
    try {
      const response = await api<{ task_id: string }>(
        "/api/acquisition/upload",
        "POST",
        formData,
      );
      setUploadTaskId(response.task_id);
      toast.success("Upload queued");
      setUploadFiles([]);
      refetchQueue();
    } catch {
      toast.error("Failed to queue upload");
    } finally {
      setUploading(false);
    }
  }

  const activeQueue =
    queue?.filter((q) =>
      ["downloading", "queued", "processing"].includes(q.status),
    ) ?? [];
  const wishlist = queue?.filter((q) => q.status === "wishlist") ?? [];
  const history =
    queue?.filter((q) => ["completed", "failed"].includes(q.status)) ?? [];

  const queueReadState = acquisitionError ? (
    <ErrorState
      message="Could not load acquisition queue."
      onRetry={refetchQueue}
    />
  ) : (
    <LoadingState
      label={
        acquisitionLoading
          ? "Loading acquisition queue"
          : "Waiting for acquisition queue"
      }
    />
  );
  return (
    <div className="space-y-6">
      <OpsPageHero
        title="Acquisition"
        description="Find music, bring it into the library, and follow every import."
      >
        <InfoBadge tone={tidalAuthenticated ? "accent" : "warning"}>
          {tidalAuthenticated == null
            ? "Tidal status unavailable"
            : `Tidal ${tidalAuthenticated ? "connected" : "disconnected"}`}
        </InfoBadge>
        {currentAcquisitionSurface ? (
          <InfoBadge>
            {activeQueue.length + slskDownloads.length} active downloads
          </InfoBadge>
        ) : null}
        {wishlist.length > 0 ? (
          <InfoBadge>{wishlist.length} wishlisted</InfoBadge>
        ) : null}
      </OpsPageHero>

      {acquisitionError && currentAcquisitionSurface ? (
        <OpsRefreshNotice
          message="Could not refresh acquisition. Showing the last successful queue."
          onRetry={refetchQueue}
        />
      ) : null}
      {suggestionsError ? (
        <OpsRefreshNotice
          message="Could not load listener suggestions."
          onRetry={refetchArtistSuggestions}
        />
      ) : suggestionsLoading && !artistSuggestions ? (
        <LoadingState label="Loading listener suggestions" />
      ) : null}
      <OpsSurface
        as="div"
        role="region"
        aria-label="Music search"
        className="overflow-hidden p-4 sm:p-6"
      >
        <div className="grid gap-5">
          <header className="grid gap-2 sm:flex sm:items-end sm:justify-between sm:gap-6">
            <div className="grid gap-2">
              <MonoLabel as="h2" tone="accent">
                Find music
              </MonoLabel>
              <p className="m-0 max-w-2xl text-sm text-text-muted">
                Search Tidal and Soulseek together, then choose the release you
                want to add to Crate.
              </p>
            </div>
            <p className="m-0 text-xs text-text-subtle sm:max-w-xs sm:text-right">
              Tidal searches from 2 characters. Soulseek joins at 3.
            </p>
          </header>

          <form
            aria-label="Acquisition search"
            className="grid items-stretch gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void doSearch();
            }}
          >
            <SearchInput
              label="Search music"
              containerClassName="min-w-0"
              value={query}
              onValueChange={setQuery}
              placeholder="Artist, album, or track"
            />
            <Button
              type="submit"
              disabled={searching || query.trim().length < 2}
              className="min-w-32"
            >
              {searching ? (
                <Loader2 size={14} className="mr-2 animate-spin" />
              ) : null}
              Search
            </Button>
          </form>

          <div className="grid gap-4 border-t border-border-quiet pt-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="crate-form-field">
              <MonoLabel as="span">Download quality</MonoLabel>
              <p className="m-0 max-w-xl text-xs text-text-subtle">
                Used for Tidal downloads and wishlist items. Soulseek keeps the
                quality offered by each peer.
              </p>
            </div>
            <SegmentedControl
              as="radio"
              label="Tidal download quality"
              value={quality}
              onValueChange={setQuality}
              items={[
                { value: "max", label: "Max (HiRes)" },
                { value: "high", label: "High (FLAC)" },
                { value: "normal", label: "Normal" },
              ]}
            />
          </div>
        </div>
      </OpsSurface>

      {suggestions.length > 0 ? (
        <OpsSurface
          as="div"
          role="region"
          aria-label="Listener suggestions"
          className="grid gap-4 p-4 sm:p-5"
        >
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <MonoLabel as="h2" tone="accent">
                Listener suggestions
              </MonoLabel>
              <p className="m-0 text-sm text-text-muted">
                Artist requests from Listen, ready to search and review.
              </p>
            </div>
            <InfoBadge>{suggestions.length} open</InfoBadge>
          </header>
          <div className="grid gap-3 xl:grid-cols-2">
            {suggestions.slice(0, 6).map((suggestion) => {
              const requester =
                suggestion.created_by_name ||
                suggestion.created_by_email ||
                "Listener";
              return (
                <OpsSurface
                  as="article"
                  aria-label={`${suggestion.artist_name} artist suggestion`}
                  key={suggestion.id}
                  className="grid gap-3 p-3 sm:p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="m-0 truncate text-sm font-semibold text-text-primary font-display">
                          {suggestion.artist_name}
                        </h3>
                        <InfoBadge>
                          {suggestion.supporter_count || 1} request
                          {(suggestion.supporter_count || 1) === 1 ? "" : "s"}
                        </InfoBadge>
                      </div>
                      <p className="m-0 mt-1 text-xs text-text-subtle">
                        Suggested by {requester}
                      </p>
                      {suggestion.note ? (
                        <p className="m-0 mt-2 line-clamp-2 text-sm text-text-muted">
                          {suggestion.note}
                        </p>
                      ) : null}
                    </div>
                    {suggestion.created_by_avatar ? (
                      <img
                        src={suggestion.created_by_avatar}
                        alt=""
                        className="h-9 w-9 shrink-0 rounded-md object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-border-quiet pt-3">
                    <Button
                      onClick={() => void searchArtistSuggestion(suggestion)}
                    >
                      Search artist
                    </Button>
                    {suggestion.artist_url ? (
                      <Button variant="outline" asChild>
                        <a
                          href={suggestion.artist_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open link
                        </a>
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      onClick={() =>
                        void updateArtistSuggestionStatus(
                          suggestion,
                          "dismissed",
                        )
                      }
                    >
                      Dismiss
                    </Button>
                  </div>
                </OpsSurface>
              );
            })}
          </div>
        </OpsSurface>
      ) : null}

      {browsingArtist && (
        <TidalArtistBrowser
          artistId={browsingArtist.id}
          artistName={browsingArtist.name}
          artistPicture={browsingArtist.picture}
          onBack={() => setBrowsingArtist(null)}
          onDownload={(url, title, upgradeAlbumId) =>
            startDownload(url, title, "search", upgradeAlbumId)
          }
          onWishlist={(item) => addToWishlist(item)}
          activeDownloads={activeDownloads}
        />
      )}

      <Tabs defaultValue="search" className={browsingArtist ? "hidden" : ""}>
        <TabsList>
          <TabsTrigger value="search">Search Results</TabsTrigger>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="queue">
            Queue{" "}
            {activeQueue.length + slskDownloads.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {activeQueue.length + slskDownloads.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="wishlist">
            Wishlist{" "}
            {wishlist.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {wishlist.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* Search Results */}
        <TabsContent value="search" className="mt-6">
          <Tabs
            value={resultTab}
            onValueChange={(value) =>
              setResultTab(value as "tidal" | "soulseek")
            }
            className="gap-5"
          >
            <TabsList aria-label="Search result provider">
              <TabsTrigger value="tidal">
                Tidal
                {results && (
                  <span className="ml-2 tabular-nums text-text-subtle">
                    {(results.artists?.length || 0) +
                      (results.albums?.length || 0) +
                      (results.tracks?.length || 0)}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="soulseek">
                Soulseek
                {soulseekResults && (
                  <span className="ml-2 tabular-nums text-text-subtle">
                    {soulseekResults.length}
                  </span>
                )}
                {searchingSlsk ? (
                  <Loader2 size={12} className="ml-2 animate-spin" />
                ) : null}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="tidal" className="mt-0">
              {searchError ? (
                <ErrorState
                  message={searchError}
                  onRetry={() => void doSearch()}
                />
              ) : searching ? (
                <LoadingState label="Searching Tidal" />
              ) : results ? (
                <div className="space-y-8">
                  {/* Artists */}
                  {(results.artists ?? []).length > 0 && (
                    <div>
                      <MonoLabel as="h2" tone="accent" className="mb-3">
                        Artists
                      </MonoLabel>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                        {results.artists!.map((artist) => (
                          <div
                            role="button"
                            tabIndex={0}
                            key={artist.id}
                            className="group min-h-11 cursor-pointer rounded-md border border-border-quiet bg-raised-surface p-4 text-center transition-colors pointer-fine:hover:bg-accent-action/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                            onClick={() =>
                              setBrowsingArtist({
                                id: artist.id,
                                name: artist.name,
                                picture: artist.picture,
                              })
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setBrowsingArtist({
                                  id: artist.id,
                                  name: artist.name,
                                  picture: artist.picture,
                                });
                              }
                            }}
                          >
                            <div className="relative mx-auto mb-3 aspect-square w-full overflow-hidden rounded-md">
                              <span className="absolute inset-0 grid place-items-center font-mono text-xl text-text-subtle">
                                {artist.name.slice(0, 1).toUpperCase()}
                              </span>
                              {artist.picture ? (
                                <img
                                  src={artist.picture}
                                  alt={artist.name}
                                  className="relative h-full w-full object-cover"
                                  onError={(event) => {
                                    event.currentTarget.style.display = "none";
                                  }}
                                />
                              ) : null}
                            </div>
                            <div className="mb-1 truncate text-sm font-semibold text-text-primary group-hover:text-accent-action-hi">
                              {artist.name}
                            </div>
                            <div className="text-xs text-text-muted">
                              Click to browse albums
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Albums */}
                  {(results.albums ?? []).length > 0 && (
                    <div>
                      <MonoLabel as="h2" tone="accent" className="mb-3">
                        Albums
                      </MonoLabel>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                        {results.albums!.map((album) => (
                          <TidalAlbumCard
                            key={album.id}
                            album={album}
                            isDownloading={activeDownloads.has(album.url)}
                            onDownloadAlbum={() =>
                              startDownload(
                                album.url,
                                `${album.artist} - ${album.title}`,
                              )
                            }
                            onDownloadTrack={(trackUrl, title) =>
                              startDownload(trackUrl, title)
                            }
                            onWishlist={() =>
                              addToWishlist({
                                url: album.url,
                                tidal_id: album.id,
                                title: album.title,
                                artist: album.artist,
                                cover_url: album.cover,
                              })
                            }
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tracks */}
                  {(results.tracks ?? []).length > 0 && (
                    <div>
                      <MonoLabel as="h2" tone="accent" className="mb-3">
                        Tracks
                      </MonoLabel>
                      <div className="space-y-1">
                        {results.tracks!.map((track) => (
                          <div
                            key={track.id}
                            className="group flex items-center gap-3 rounded-md px-3 py-2 transition-colors"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="truncate text-sm text-text-primary">
                                {track.title}
                              </div>
                              <div className="truncate text-xs text-text-muted">
                                {track.artist} — {track.album}
                              </div>
                            </div>
                            <span className="text-xs text-text-muted">
                              {fmtDuration(track.duration)}
                            </span>
                            <ActionIconButton
                              title="Add to wishlist"
                              aria-label={`Add ${track.title} to wishlist`}
                              className="text-text-muted pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 focus-visible:opacity-100"
                              onClick={() =>
                                addToWishlist({
                                  url: track.url,
                                  tidal_id: track.id,
                                  title: track.title,
                                  artist: track.artist,
                                  content_type: "track",
                                })
                              }
                            >
                              <HeartIcon
                                size={CRATE_ICON_SIZE.sm}
                                aria-hidden="true"
                              />
                            </ActionIconButton>
                            <ActionIconButton
                              title="Download"
                              aria-label={`Download ${track.title}`}
                              className="text-text-muted"
                              onClick={() =>
                                startDownload(
                                  track.url,
                                  `${track.artist} - ${track.title}`,
                                )
                              }
                            >
                              <DownloadActionIcon
                                size={CRATE_ICON_SIZE.sm}
                                aria-hidden="true"
                              />
                            </ActionIconButton>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!results.albums?.length &&
                    !results.tracks?.length &&
                    !results.artists?.length && (
                      <div className="grid min-h-44 content-center justify-items-center gap-2 rounded-md border border-dashed border-border-quiet px-5 py-8 text-center">
                        <MonoLabel as="span" tone="accent">
                          No matches
                        </MonoLabel>
                        <p className="m-0 text-sm text-text-muted">
                          No Tidal results for “{query.trim()}”. Try another
                          name or search term.
                        </p>
                      </div>
                    )}
                </div>
              ) : (
                <div className="grid min-h-56 content-center justify-items-center gap-3 rounded-md border border-dashed border-border-quiet px-5 py-8 text-center">
                  <MonoLabel as="span" tone="accent">
                    Ready when you are
                  </MonoLabel>
                  <p className="m-0 max-w-md text-sm text-text-muted">
                    Search by artist, album, or track. Tidal and Soulseek
                    results will appear here under their own source.
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="soulseek" className="mt-0">
              <div>
                {soulseekError ? (
                  <ErrorState
                    message={soulseekError}
                    onRetry={() => void doSearch()}
                  />
                ) : soulseekResults && soulseekResults.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {soulseekResults.map((r) => (
                      <SlskResultCard
                        key={`${r.username}-${r.artist}-${r.album}-${r.totalSize}`}
                        result={r}
                        onDownload={() => downloadFromSoulseek(r)}
                      />
                    ))}
                  </div>
                ) : soulseekResults && soulseekResults.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4">
                    No Soulseek results
                  </div>
                ) : searchingSlsk ? (
                  <div className="text-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" />
                  </div>
                ) : query.trim().length >= 2 && query.trim().length < 3 ? (
                  <div className="grid min-h-44 content-center justify-items-center gap-2 rounded-md border border-dashed border-border-quiet px-5 py-8 text-center">
                    <MonoLabel as="span" tone="accent">
                      Add one more character
                    </MonoLabel>
                    <p className="m-0 text-sm text-text-muted">
                      Soulseek starts searching when your query has at least 3
                      characters.
                    </p>
                  </div>
                ) : (
                  <div className="grid min-h-44 content-center justify-items-center gap-2 rounded-md border border-dashed border-border-quiet px-5 py-8 text-center">
                    <MonoLabel as="span" tone="accent">
                      Soulseek results
                    </MonoLabel>
                    <p className="m-0 text-sm text-text-muted">
                      Search for an artist, album, or track to find available
                      files from peers.
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="upload">
          <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.75fr)]">
            <OpsSurface
              as="article"
              role="region"
              aria-label="Upload music"
              className="grid content-start gap-4 p-4 sm:p-5"
            >
              <header className="grid gap-2">
                <MonoLabel as="h2" tone="accent">
                  Add music
                </MonoLabel>
                <p className="m-0 max-w-2xl text-sm text-text-muted">
                  Choose individual tracks or a ZIP album. Drop files here or
                  browse your device.
                </p>
              </header>
              <div
                role="group"
                aria-label="Upload music files"
                onDragEnter={(event) => {
                  event.preventDefault();
                  setUploadDragActive(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setUploadDragActive(true);
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget === event.target) {
                    setUploadDragActive(false);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setUploadDragActive(false);
                  setUploadFiles(Array.from(event.dataTransfer.files));
                }}
                className={`grid min-h-56 content-center justify-items-center gap-3 rounded-md border border-dashed px-5 py-8 text-center transition-colors ${
                  uploadDragActive
                    ? "border-accent-action bg-accent-action/[0.08]"
                    : "border-border-quiet hover:border-accent-action/50"
                }`}
              >
                <label
                  htmlFor="acquisition-upload-files"
                  className="cursor-pointer text-sm font-semibold text-text-primary underline decoration-border-quiet underline-offset-4 hover:text-accent-action-hi"
                >
                  Choose files
                </label>
                <input
                  id="acquisition-upload-files"
                  type="file"
                  multiple
                  accept=".flac,.mp3,.m4a,.ogg,.opus,.wav,.aac,.alac,.zip,audio/*"
                  aria-label="Choose music files"
                  className="sr-only"
                  onChange={(event) =>
                    setUploadFiles(Array.from(event.target.files || []))
                  }
                />
                <p className="m-0 text-xs text-text-subtle">
                  FLAC, MP3, AAC, WAV, OGG, OPUS, ALAC, or ZIP
                </p>
              </div>
              {uploadFiles.length > 0 ? (
                <div className="grid gap-3 rounded-md border border-border-quiet p-3 sm:p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <MonoLabel as="span" tone="accent">
                      {uploadFiles.length} file
                      {uploadFiles.length === 1 ? "" : "s"} ready to import
                    </MonoLabel>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setUploadFiles([])}
                    >
                      Clear selection
                    </Button>
                  </div>
                  <div className="grid max-h-56 gap-1 overflow-y-auto">
                    {uploadFiles.map((file) => (
                      <div
                        key={`${file.name}-${file.size}-${file.lastModified}`}
                        className="flex min-w-0 items-center gap-3 rounded-md px-2 py-2 text-sm text-text-secondary"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {file.name}
                        </span>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-text-subtle">
                          {Math.round((file.size / 1024 / 1024) * 10) / 10} MB
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </OpsSurface>

            <OpsSurface
              as="article"
              aria-label="Import details"
              className="grid content-start gap-5 p-4 sm:p-5"
            >
              <header className="grid gap-2">
                <MonoLabel as="h2" tone="accent">
                  After import
                </MonoLabel>
                <p className="m-0 text-sm text-text-muted">
                  Your music joins the shared library and appears in your
                  collection when processing finishes.
                </p>
              </header>
              <Button
                onClick={submitUpload}
                disabled={uploading || uploadFiles.length === 0}
                className="w-full"
              >
                {uploading ? (
                  <Loader2 size={14} className="mr-2 animate-spin" />
                ) : null}
                Add to library
              </Button>
              {uploadTaskId ? (
                <div
                  role="status"
                  className="grid gap-1 rounded-md border border-accent-action/20 bg-accent-action/10 px-3 py-3 text-sm text-accent-action-hi"
                >
                  <MonoLabel as="span" tone="accent">
                    Upload queued
                  </MonoLabel>
                  <p className="m-0 text-xs text-text-muted">
                    Follow its progress from the Queue tab.
                  </p>
                </div>
              ) : null}
            </OpsSurface>
          </div>
        </TabsContent>

        {/* Queue */}
        <TabsContent value="queue">
          <section aria-label="Active downloads" className="mt-5 grid gap-4">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="grid gap-2">
                <MonoLabel as="h2" tone="accent">
                  Active downloads
                </MonoLabel>
                <p className="m-0 text-sm text-text-muted">
                  Follow current transfers and manage work already in progress.
                </p>
              </div>
              {(slskDownloads.length > 0 || activeQueue.length > 0) && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await api(
                        "/api/acquisition/queue/clear-completed",
                        "POST",
                      );
                      refetchQueue();
                      toast.success("Cleared completed downloads");
                    }}
                  >
                    Clear completed
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await api("/api/acquisition/queue/clear-errored", "POST");
                      refetchQueue();
                      toast.success("Cleared errored downloads");
                    }}
                  >
                    Clear errors
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await api(
                        "/api/acquisition/queue/cleanup-incomplete",
                        "POST",
                      );
                      toast.success("Cleanup task created");
                    }}
                  >
                    Clean incomplete albums
                  </Button>
                </div>
              )}
            </header>
            {!currentAcquisitionSurface ? (
              queueReadState
            ) : activeQueue.length === 0 && slskDownloads.length === 0 ? (
              <OpsSurface
                role="status"
                className="grid min-h-48 content-center justify-items-center gap-2 px-5 py-8 text-center"
              >
                <MonoLabel as="span" tone="accent">
                  Queue is clear
                </MonoLabel>
                <p className="m-0 max-w-md text-sm text-text-muted">
                  Downloads you start or promote from your wishlist will appear
                  here.
                </p>
              </OpsSurface>
            ) : (
              <>
                {activeQueue.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    onRemove={removeQueueItem}
                    busy={queueBusy.has(item.id)}
                  />
                ))}
                {slskDownloads.map((d) => (
                  <OpsSurface
                    as="article"
                    aria-label={`${d.artist} — ${d.album}`}
                    key={`slsk-${d.username}-${d.artist}-${d.album}-${d.filename}`}
                    className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-3 sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-4"
                  >
                    <EntityAvatar
                      name={d.album}
                      alt=""
                      shape="rounded"
                      size="md"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-text-primary">
                        {d.filename || d.album}
                      </div>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                        <span className="truncate">
                          {d.artist} · {d.album}
                        </span>
                        <InfoBadge tone="accent">Soulseek</InfoBadge>
                        <span>{d.username}</span>
                        {d.speed > 0 ? (
                          <span className="font-mono tabular-nums">
                            {Math.round(d.speed / 1024)} KB/s
                          </span>
                        ) : null}
                      </div>
                      {d.progress > 0 && d.progress < 100 ? (
                        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                          <div
                            role="progressbar"
                            aria-label={`${d.album} download progress`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={d.progress}
                            className="h-px overflow-hidden rounded-full bg-border-quiet"
                          >
                            <div
                              className="h-full rounded-full bg-accent-action transition-[width]"
                              style={{ width: `${d.progress}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs tabular-nums text-text-subtle">
                            {d.progress}%
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <div className="col-start-2 flex items-center justify-between gap-2 sm:col-start-auto sm:justify-end">
                      <InfoBadge
                        tone={
                          d.status.includes("Errored") ||
                          d.status.includes("Rejected") ||
                          d.status.includes("Aborted")
                            ? "warning"
                            : d.progress >= 100
                              ? "success"
                              : "neutral"
                        }
                      >
                        {d.status}
                      </InfoBadge>

                      {(d.status.includes("Errored") ||
                        d.status.includes("Rejected") ||
                        d.status.includes("Aborted")) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-shrink-0"
                          onClick={async () => {
                            // Parse artist from directory path (e.g. "music/D/Dredg - 2002 - El Cielo/track.flac")
                            const path = (
                              d.fullPath ||
                              d.filename ||
                              ""
                            ).replace(/\\/g, "/");
                            const parts = path.split("/");
                            const dirName =
                              parts.length >= 2 ? parts[parts.length - 2] : "";
                            // Try to extract artist from parent dir
                            const artistGuess =
                              parts.length >= 3 ? parts[parts.length - 3] : "";
                            const trackName =
                              parts[parts.length - 1]
                                ?.replace(/\.[^.]+$/, "")
                                .replace(/^\d+[\s._-]*/, "") || d.filename;

                            try {
                              await api("/api/acquisition/download", "POST", {
                                source: "soulseek",
                                find_alternate: true,
                                artist: d.artist || artistGuess,
                                album: d.album || dirName,
                                files: [
                                  {
                                    filename: d.fullPath || d.filename,
                                    size: 0,
                                  },
                                ],
                              });
                              toast.success(
                                `Searching alternate peer for: ${trackName}`,
                              );
                              refetchQueue();
                            } catch {
                              toast.error("Retry failed");
                            }
                          }}
                        >
                          {" "}
                          Find alternate
                        </Button>
                      )}
                    </div>
                  </OpsSurface>
                ))}
              </>
            )}
          </section>
        </TabsContent>

        {/* Wishlist */}
        <TabsContent value="wishlist">
          <section aria-label="Download wishlist" className="mt-5 grid gap-4">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="grid gap-2">
                <MonoLabel as="h2" tone="accent">
                  Wishlist
                </MonoLabel>
                <p className="m-0 text-sm text-text-muted">
                  Save releases to download later, or send the whole list to the
                  queue.
                </p>
              </div>
              {wishlist.length > 0 ? (
                <Button
                  onClick={() => void promoteAllWishlist()}
                  disabled={queueBusy.size > 0}
                  aria-busy={queueBusy.size > 0}
                >
                  Download all ({wishlist.length})
                </Button>
              ) : null}
            </header>
            {!currentAcquisitionSurface ? (
              queueReadState
            ) : wishlist.length === 0 ? (
              <OpsSurface
                role="status"
                className="grid min-h-48 content-center justify-items-center gap-2 px-5 py-8 text-center"
              >
                <MonoLabel as="span" tone="accent">
                  Wishlist is empty
                </MonoLabel>
                <p className="m-0 max-w-md text-sm text-text-muted">
                  Save an album from Tidal search results and it will be ready
                  here when you are.
                </p>
              </OpsSurface>
            ) : (
              <div className="grid gap-3">
                {wishlist.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    onRemove={removeQueueItem}
                    busy={queueBusy.has(item.id)}
                    onPromote={promoteWishlist}
                  />
                ))}
              </div>
            )}
          </section>
        </TabsContent>

        {/* History */}
        <TabsContent value="history">
          <section aria-label="Download history" className="mt-5 grid gap-4">
            <header className="grid gap-2">
              <MonoLabel as="h2" tone="accent">
                Download history
              </MonoLabel>
              <p className="m-0 text-sm text-text-muted">
                Check completed downloads and anything that needs another try.
              </p>
            </header>
            {!currentAcquisitionSurface ? (
              queueReadState
            ) : history.length === 0 ? (
              <OpsSurface
                role="status"
                className="grid min-h-48 content-center justify-items-center gap-2 px-5 py-8 text-center"
              >
                <MonoLabel as="span" tone="accent">
                  Nothing here yet
                </MonoLabel>
                <p className="m-0 max-w-md text-sm text-text-muted">
                  Finished and unsuccessful downloads will be listed here.
                </p>
              </OpsSurface>
            ) : (
              <div className="grid gap-3">
                {history.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    onRemove={removeQueueItem}
                    busy={queueBusy.has(item.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function QueueRow({
  item,
  onRemove,
  onPromote,
  busy = false,
}: {
  item: QueueItem;
  busy?: boolean;
  onRemove: (id: number) => void;
  onPromote?: (id: number) => void;
}) {
  const statusTone =
    item.status === "completed" || item.status === "wishlist"
      ? "accent"
      : item.status === "failed"
        ? "warning"
        : "neutral";

  return (
    <OpsSurface
      as="article"
      aria-label={item.title}
      className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-3 sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-4"
    >
      <EntityAvatar
        src={item.cover_url}
        name={item.title}
        alt=""
        shape="rounded"
        size="md"
      />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-text-primary">
          {item.title}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
          {item.artist ? <span className="truncate">{item.artist}</span> : null}
          <span>{item.source}</span>
          <span className="font-mono text-text-subtle">{item.quality}</span>
        </div>
      </div>
      <div className="col-start-2 flex items-center justify-between gap-2 sm:col-start-auto sm:justify-end">
        <InfoBadge tone={statusTone}>{item.status}</InfoBadge>
        <div className="flex items-center gap-1">
          {onPromote && item.status === "wishlist" ? (
            <ActionIconButton
              title={`Download ${item.title} now`}
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => onPromote(item.id)}
            >
              <ArrowUp size={15} aria-hidden="true" />
            </ActionIconButton>
          ) : null}
          <ActionIconButton
            title={`Remove ${item.title} from acquisition`}
            disabled={busy}
            onClick={() => onRemove(item.id)}
          >
            <Trash2 size={15} aria-hidden="true" />
          </ActionIconButton>
        </div>
      </div>
    </OpsSurface>
  );
}

// ── Tidal Artist Album Browser ─────────────────────────────────

interface TidalArtistAlbum {
  id: string;
  title: string;
  artist: string;
  year: string;
  tracks: number;
  cover: string | null;
  url: string;
  quality: string[];
  duration: number;
  release_date: string;
  type: string;
  status: "local" | "available";
  local_quality?: { format?: string; bit_depth?: number; sample_rate?: number };
  local_album_id?: number;
}

function TidalArtistBrowser({
  artistId,
  artistName,
  artistPicture,
  onBack,
  onDownload,
  onWishlist,
  activeDownloads,
}: {
  artistId: string;
  artistName: string;
  artistPicture: string | null;
  onBack: () => void;
  onDownload: (url: string, title: string, upgradeAlbumId?: number) => void;
  onWishlist: (item: {
    url: string;
    tidal_id: string;
    title: string;
    artist: string;
    cover_url?: string | null;
  }) => void;
  activeDownloads: Set<string>;
}) {
  const { data, loading, error, refetch } = useApi<{
    albums: TidalArtistAlbum[];
    artist_name: string;
  }>(`/api/tidal/artists/${artistId}/albums`);

  const albums = data?.albums ?? [];
  const localCount = albums.filter((a) => a.status === "local").length;
  const availableCount = albums.filter((a) => a.status === "available").length;

  return (
    <section aria-label={`${artistName} Tidal albums`} className="grid gap-4">
      {error && data ? (
        <OpsRefreshNotice
          message="Could not refresh artist albums. Showing the last successful list."
          onRetry={refetch}
        />
      ) : null}
      <OpsSurface
        as="div"
        className="flex flex-wrap items-center gap-3 p-3 sm:p-4"
      >
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" />
          Back to results
        </Button>
        {artistPicture ? (
          <img
            src={artistPicture}
            alt=""
            className="h-12 w-12 rounded-md border border-border-quiet object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <MonoLabel as="h2" tone="accent">
            {artistName} on Tidal
          </MonoLabel>
          <p className="m-0 mt-1 text-sm text-text-muted">
            Browse releases and compare them with your local library.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data ? <InfoBadge>{albums.length} albums</InfoBadge> : null}
          {localCount > 0 ? (
            <InfoBadge tone="accent">{localCount} in library</InfoBadge>
          ) : null}
          {availableCount > 0 ? (
            <InfoBadge tone="neutral">{availableCount} to add</InfoBadge>
          ) : null}
        </div>
        {availableCount > 0 ? (
          <Button
            className="w-full sm:ml-auto sm:w-auto"
            onClick={() => {
              for (const album of albums) {
                if (album.status === "available") {
                  onDownload(album.url, `${album.artist} - ${album.title}`);
                }
              }
            }}
          >
            Download {availableCount} missing album
            {availableCount === 1 ? "" : "s"}
          </Button>
        ) : null}
      </OpsSurface>

      {error && !data ? (
        <ErrorState
          message="Could not load Tidal artist albums."
          onRetry={refetch}
        />
      ) : loading && !data ? (
        <OpsSurface
          role="status"
          className="grid min-h-48 place-items-center px-4 py-8 text-center"
        >
          <MonoLabel as="span" tone="accent">
            Loading {artistName} albums
          </MonoLabel>
        </OpsSurface>
      ) : albums.length === 0 ? (
        <OpsSurface
          role="status"
          className="grid min-h-48 place-items-center gap-2 px-4 py-8 text-center"
        >
          <MonoLabel as="span" tone="accent">
            No Tidal albums found
          </MonoLabel>
          <p className="m-0 text-sm text-text-muted">
            Try another artist or return to your search results.
          </p>
        </OpsSurface>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {albums.map((album) => (
            <TidalAlbumCard
              key={album.id}
              album={album}
              status={album.status}
              localQuality={album.local_quality}
              isDownloading={activeDownloads.has(album.url)}
              onDownloadAlbum={() =>
                onDownload(
                  album.url,
                  `${album.artist} - ${album.title}`,
                  album.local_album_id,
                )
              }
              onDownloadTrack={(trackUrl, title) => onDownload(trackUrl, title)}
              onWishlist={() =>
                onWishlist({
                  url: album.url,
                  tidal_id: album.id,
                  title: album.title,
                  artist: album.artist,
                  cover_url: album.cover,
                })
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Tidal Album Card (unified — used in search + artist browser) ──

interface TidalTrackItem {
  id: string;
  title: string;
  artist: string;
  track_number: number;
  duration: number;
  url: string;
  quality: string[];
}

function TidalAlbumCard({
  album,
  isDownloading,
  onDownloadAlbum,
  onDownloadTrack,
  onWishlist,
  status,
  localQuality,
}: {
  album: TidalAlbum;
  isDownloading: boolean;
  onDownloadAlbum: () => void;
  onDownloadTrack: (url: string, title: string) => void;
  onWishlist: () => void;
  status?: "local" | "available";
  localQuality?: { format?: string; bit_depth?: number; sample_rate?: number };
}) {
  const [open, setOpen] = useState(false);
  const [tracks, setTracks] = useState<TidalTrackItem[] | null>(null);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [tracksError, setTracksError] = useState<string | null>(null);
  const isLocal = status === "local";
  const tidalTier = qualityTier(album.quality);
  const localTier = localQuality ? localQualityTier(localQuality) : 0;
  const hasUpgrade = isLocal && tidalTier > localTier;
  const normalizedQuality = normalizeQualityTags(album.quality);

  async function openTracklist() {
    setOpen(true);
    if (!tracks) {
      setLoadingTracks(true);
      setTracksError(null);
      try {
        const data = await api<{ tracks: TidalTrackItem[] }>(
          `/api/tidal/albums/${album.id}/tracks`,
        );
        setTracks(data.tracks);
      } catch {
        setTracksError("Could not load album tracks.");
      } finally {
        setLoadingTracks(false);
      }
    }
  }

  return (
    <>
      <OpsSurface
        as="article"
        aria-label={`${album.title} Tidal album`}
        className={`overflow-hidden p-0 ${
          isLocal && hasUpgrade ? "border-state-warning/40" : ""
        }`}
      >
        <div className="relative aspect-square w-full">
          {album.cover ? (
            <img
              src={album.cover}
              alt={album.title}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <div className="grid h-full w-full place-items-center font-mono text-2xl text-text-subtle">
              {album.title.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <div className="grid gap-3 p-3">
          <div className="min-w-0">
            <h3 className="m-0 truncate text-sm font-semibold text-text-primary font-display">
              {album.title}
            </h3>
            <p className="m-0 mt-1 truncate text-xs text-text-muted">
              {album.artist}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {album.year ? <InfoBadge>{album.year}</InfoBadge> : null}
            <InfoBadge>{album.tracks} tracks</InfoBadge>
            {album.type && album.type !== "ALBUM" ? (
              <InfoBadge>{album.type}</InfoBadge>
            ) : null}
            {isLocal && !hasUpgrade ? (
              <InfoBadge tone="accent">In library</InfoBadge>
            ) : null}
            {hasUpgrade ? (
              <InfoBadge tone="warning">Upgrade available</InfoBadge>
            ) : null}
            {normalizedQuality.map((q) => (
              <InfoBadge
                key={q.label}
                tone={
                  q.tier === "hi-res" || q.tier === "lossless"
                    ? "accent"
                    : q.tier === "high"
                      ? "info"
                      : "neutral"
                }
              >
                {q.label}
              </InfoBadge>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-border-quiet pt-3">
            <Button
              className="col-span-2 w-full"
              onClick={onDownloadAlbum}
              disabled={isDownloading || (isLocal && !hasUpgrade)}
            >
              {isDownloading
                ? "Download queued"
                : hasUpgrade
                  ? "Get upgrade"
                  : isLocal
                    ? "In library"
                    : "Download album"}
            </Button>
            <Button
              variant="outline"
              className="w-full px-2 text-xs"
              onClick={openTracklist}
            >
              View tracks
            </Button>
            <Button
              variant="outline"
              className="w-full px-2 text-xs"
              onClick={onWishlist}
            >
              Wishlist
            </Button>
          </div>
        </div>
      </OpsSurface>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <div className="flex min-w-0 items-center gap-3">
              {album.cover && (
                <img
                  src={album.cover}
                  alt=""
                  className="h-12 w-12 rounded-md object-cover"
                />
              )}
              <div className="min-w-0">
                <DialogTitle className="truncate font-display">
                  {album.title}
                </DialogTitle>
                <p className="m-0 text-sm text-text-muted">
                  {album.artist} {album.year && `(${album.year})`}
                </p>
              </div>
            </div>
          </DialogHeader>
          <div className="mt-2">
            {loadingTracks ? (
              <div className="flex items-center justify-center py-8">
                <Loader2
                  size={18}
                  className="animate-spin text-muted-foreground"
                />
              </div>
            ) : tracksError ? (
              <ErrorState
                message={tracksError}
                onRetry={() => void openTracklist()}
              />
            ) : !tracks?.length ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No tracks found
              </div>
            ) : (
              <div className="space-y-0.5 max-h-[400px] overflow-y-auto">
                {tracks.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 py-1.5 px-2 rounded  group/track"
                  >
                    <span className="text-[11px] text-muted-foreground w-5 text-right font-mono">
                      {t.track_number}
                    </span>
                    <span className="text-sm flex-1 truncate">{t.title}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {fmtDuration(t.duration)}
                    </span>
                    <ActionIconButton
                      onClick={() =>
                        onDownloadTrack(t.url, `${t.artist} - ${t.title}`)
                      }
                      title="Download"
                      aria-label={`Download ${t.title}`}
                    >
                      <DownloadActionIcon
                        size={CRATE_ICON_SIZE.sm}
                        aria-hidden="true"
                      />
                    </ActionIconButton>
                  </div>
                ))}
              </div>
            )}
            <div className="grid gap-2 border-t border-border-quiet pt-3 sm:grid-cols-2">
              <Button
                onClick={() => {
                  onDownloadAlbum();
                  setOpen(false);
                }}
                disabled={isDownloading || (isLocal && !hasUpgrade)}
              >
                {isDownloading ? "Download queued" : "Download full album"}
              </Button>
              <Button variant="outline" onClick={onWishlist}>
                Add to wishlist
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Soulseek Result Card (with cover + tracklist modal) ────────

function SlskResultCard({
  result: r,
  onDownload,
}: {
  result: SoulseekResult;
  onDownload: () => void;
}) {
  const cover = useAlbumCover(r.artist, r.album);
  const [open, setOpen] = useState(false);

  return (
    <>
      <article className="group overflow-hidden rounded-md border border-border-quiet bg-surface-object transition-colors hover:border-accent-action/30">
        <div className="flex gap-3 p-3">
          <div className="w-14 h-14 rounded bg-secondary flex-shrink-0 overflow-hidden relative">
            {cover ? (
              <img
                src={cover}
                alt={`${r.artist} - ${r.album}`}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <span className="font-display text-2xl font-semibold text-text-subtle">
                  {r.album.slice(0, 1).toUpperCase()}
                </span>
              </div>
            )}
            <ActionIconButton
              onClick={() => setOpen(true)}
              title="View files"
              className="absolute bottom-1 right-1 transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 focus-visible:opacity-100"
            >
              <List size={14} aria-hidden="true" />
            </ActionIconButton>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div>
              <div className="text-sm font-medium truncate">{r.album}</div>
              <div className="text-xs text-muted-foreground truncate">
                {r.artist}
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              <InfoBadge
                tone={
                  r.quality.toLowerCase().includes("flac")
                    ? "accent"
                    : "neutral"
                }
              >
                {r.quality}
              </InfoBadge>
              <InfoBadge>{r.files.length} tracks</InfoBadge>
              <InfoBadge>{Math.round(r.totalSize / 1048576)} MB</InfoBadge>
              {r.freeSlot && <InfoBadge tone="success">Free slot</InfoBadge>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-text-muted">
                <span className="font-mono">{r.username}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {r.speed > 1048576
                    ? `${(r.speed / 1048576).toFixed(1)} MB/s`
                    : `${Math.round(r.speed / 1024)} KB/s`}
                </span>
              </div>
              <Button size="sm" variant="outline" onClick={onDownload}>
                Download
              </Button>
            </div>
          </div>
        </div>
      </article>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              {cover ? (
                <img
                  src={cover}
                  alt=""
                  className="w-12 h-12 rounded object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded font-display text-xl font-semibold text-text-subtle">
                  {r.album.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div>
                <DialogTitle className="font-display">{r.album}</DialogTitle>
                <p className="text-sm text-muted-foreground">{r.artist}</p>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                  <InfoBadge
                    tone={
                      r.quality.toLowerCase().includes("flac")
                        ? "accent"
                        : "neutral"
                    }
                  >
                    {r.quality}
                  </InfoBadge>
                  <span>{Math.round(r.totalSize / 1048576)} MB</span>
                  <span>from {r.username}</span>
                  <span>
                    {r.speed > 1048576
                      ? `${(r.speed / 1048576).toFixed(1)} MB/s`
                      : `${Math.round(r.speed / 1024)} KB/s`}
                  </span>
                </div>
              </div>
            </div>
          </DialogHeader>
          <div className="mt-2 space-y-0.5 max-h-[400px] overflow-y-auto">
            {r.files.map((f, i) => {
              const name =
                f.filename.replace(/\\/g, "/").split("/").pop() ?? f.filename;
              return (
                <div
                  key={`${f.filename}-${f.size}-${f.length}`}
                  className="flex items-center gap-2 py-1.5 px-2 rounded "
                >
                  <span className="text-[11px] text-muted-foreground w-5 text-right font-mono">
                    {i + 1}
                  </span>
                  <span className="text-sm flex-1 truncate">{name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {f.length > 0 ? fmtDuration(f.length) : ""}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {Math.round(f.size / 1048576)} MB
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 pt-3 border-t border-border">
            <Button
              size="sm"
              onClick={() => {
                onDownload();
                setOpen(false);
              }}
              className="w-full"
            >
              {" "}
              Download all {r.files.length} files from {r.username}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
