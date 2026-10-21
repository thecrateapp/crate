import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { BackLink } from "@crate/ui/domain/navigation/BackLink";
import { FilterChip } from "@crate/ui/primitives/FilterChip";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import {
  PageHeaderAction,
  PageHeaderActions,
} from "@/components/layout/PageHeader";
import { SeverityMeter } from "@/components/admin/status-indicators";
import { cn } from "@crate/ui/lib/cn";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useNavigate, useParams } from "react-router";
import {
  Copy,
  Eye,
  GripVertical,
  ListRestart,
  Loader2,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { AdminSelect } from "@/components/ui/AdminSelect";
import { AIButton } from "@/components/ui/AIButton";
import {
  PlaylistArtwork,
  type PlaylistArtworkTrack,
} from "@/components/playlists/PlaylistArtwork";

import { Button } from "@crate/ui/shadcn/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@crate/ui/shadcn/card";
import { Input } from "@crate/ui/shadcn/input";
import { Textarea } from "@crate/ui/shadcn/textarea";
import { useApi } from "@/hooks/use-api";
import { useActionLLMStatus } from "@/hooks/use-llm";
import { ApiError, api, apiSseUrl } from "@/lib/api";
import { timeAgo } from "@/lib/utils";

interface Playlist {
  id: number;
  name: string;
  description: string | null;
  generation_mode: "static" | "smart";
  is_smart: boolean;
  is_active: boolean;
  is_curated: boolean;
  auto_refresh_enabled: boolean;
  category: string | null;
  featured_rank: number | null;
  track_count: number;
  total_duration: number;
  follower_count: number;
  smart_rules: SmartRules | null;
  generation_status: string;
  generation_error: string | null;
  last_generated_at: string | null;
  cover_data_url: string | null;
  artwork_tracks?: PlaylistArtworkTrack[];
  tracks: Track[];
}

interface SmartRules {
  match: "all" | "any";
  rules: SmartRule[];
  limit: number;
  sort: string;
}

interface SmartRule {
  field: string;
  op: string;
  value: string | number | (string | number)[];
}

interface Track {
  id?: number;
  track_id?: number;
  entity_uid?: string | null;
  track_entity_uid?: string | null;
  track_storage_id?: string | null;
  track_path?: string | null;
  path?: string | null;
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  position?: number | null;
  source?: string | null;
  locked?: boolean | null;
  genre?: string | null;
  format?: string | null;
  year?: string | number | null;
}

interface GenerationLog {
  id: number;
  started_at: string;
  completed_at: string | null;
  status: string;
  track_count: number | null;
  duration_sec: number | null;
  error: string | null;
  triggered_by: string;
}

interface PreviewTrack {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number | null;
  year?: number | null;
  format?: string | null;
}

interface PreviewResult {
  total_matching: number;
  tracks: PreviewTrack[];
  genre_distribution: Record<string, number>;
  artist_distribution: Record<string, number>;
  format_distribution: Record<string, number>;
  duration_total_sec: number;
  avg_year: number | null;
  year_range: number[] | null;
}

interface PlaylistEditorSurface {
  playlist: Playlist;
  history: GenerationLog[];
}

interface TrackSearchResponse {
  tracks: Track[];
  scope: "rules" | "library";
}

interface RefinementIssue {
  type: string;
  severity: string;
  message: string;
  positions: number[];
}

interface RefinementAction {
  id: string;
  type: string;
  label: string;
  reason: string;
  position?: number | null;
  track_id?: number | null;
}

interface RefinementProposal {
  proposal_id: string;
  editorial_revision: number;
  summary: string;
  issues: RefinementIssue[];
  actions: RefinementAction[];
  score_version: string;
}

interface FilterOptions {
  genres: string[];
  formats: string[];
  keys: string[];
  artists: string[];
}

function apiErrorDetail(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  try {
    const parsed = JSON.parse(error.message) as { detail?: unknown };
    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return parsed.detail;
    }
  } catch {
    return error.message || fallback;
  }
  return error.message || fallback;
}

const CATEGORY_OPTIONS = [
  { value: "editorial", label: "Editorial" },
  { value: "genre", label: "Genre" },
  { value: "mood", label: "Mood" },
  { value: "activity", label: "Activity" },
  { value: "era", label: "Era" },
  { value: "seasonal", label: "Seasonal" },
];

const RULE_FIELDS = [
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
  return RULE_FIELDS.find((item) => item.value === field)?.type === "text"
    ? "text"
    : "number";
}

function getOpsForField(field: string) {
  return getFieldType(field) === "text" ? TEXT_OPS : NUMBER_OPS;
}

function numericRuleInput(field: string, value: string): string | number {
  return field === "year" ? value : Number(value);
}

function formatMinutes(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTrackDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remaining = String(wholeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remaining}`;
}

function playlistTrackPayload(track: Track): Record<string, unknown> {
  return {
    track_id: track.track_id ?? track.id,
    entity_uid: track.track_entity_uid ?? track.entity_uid,
    track_entity_uid: track.track_entity_uid ?? track.entity_uid,
    track_storage_id: track.track_storage_id,
    path: track.track_path ?? track.path,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
  };
}

function trackSourceLabel(track: Track): string {
  if (track.locked) return "locked";
  if (track.source === "manual") return "manual";
  if (track.source === "generated") return "generated";
  return track.source || "track";
}

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("crate-form-field", className)}>
      <MonoLabel as="span">{label}</MonoLabel>
      {children}
    </div>
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

function StatusChip({ status }: { status: string }) {
  if (status === "running") {
    return <InfoBadge active>Generating</InfoBadge>;
  }
  if (status === "queued") {
    return (
      <InfoBadge className="border-state-warning/25 bg-state-warning/10 text-state-warning-text">
        Queued
      </InfoBadge>
    );
  }
  if (status === "failed") {
    return (
      <InfoBadge className="border-state-warning/25 bg-state-warning/10 text-state-warning-text">
        Failed
      </InfoBadge>
    );
  }
  return <InfoBadge>Idle</InfoBadge>;
}

function MetricTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="crate-form-field rounded-md border border-white/10 bg-black/15 p-3">
      <MonoLabel as="div">{label}</MonoLabel>
      <div className="font-mono font-normal text-base">{value}</div>
    </div>
  );
}

function DistributionBlock({
  label,
  items,
}: {
  label: string;
  items: Array<[string, number]>;
}) {
  if (items.length === 0) return null;

  return (
    <div className="crate-form-field">
      <MonoLabel as="div">{label}</MonoLabel>
      <div className="flex flex-wrap gap-1.5">
        {items.map(([name, count]) => (
          <InfoBadge key={name}>
            {name} <span className="text-white/35">{count}</span>
          </InfoBadge>
        ))}
      </div>
    </div>
  );
}

export function PlaylistEditor() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const id = Number(playlistId);

  const {
    data: surface,
    loading,
    refetch,
  } = useApi<PlaylistEditorSurface>(
    id ? `/api/admin/system-playlists/${id}/editor-snapshot` : null,
  );
  const { data: filterOptions } = useApi<FilterOptions>(
    "/api/playlists/filter-options",
  );
  const llmStatus = useActionLLMStatus("playlists.description.generate");
  const llmAvailable = llmStatus?.available ?? false;
  const llmUnavailableReason =
    llmStatus?.error_code ||
    "Configure an LLM provider before generating copy.";
  const [liveSurface, setLiveSurface] = useState<PlaylistEditorSurface | null>(
    null,
  );

  const playlist = liveSurface?.playlist ?? surface?.playlist ?? null;
  const history = liveSurface?.history ?? surface?.history ?? [];

  useEffect(() => {
    setLiveSurface(surface);
  }, [surface]);

  useEffect(() => {
    if (!id) return;
    const source = new EventSource(
      apiSseUrl(`/api/admin/system-playlists/${id}/stream`),
    );
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as PlaylistEditorSurface;
        setLiveSurface(payload);
      } catch {
        // Ignore malformed frames and keep the stream alive.
      }
    };
    return () => {
      source.close();
    };
  }, [id]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [featuredRank, setFeaturedRank] = useState<number | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [isCurated, setIsCurated] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [rules, setRules] = useState<SmartRule[]>([]);
  const [match, setMatch] = useState<"all" | "any">("all");
  const [limit, setLimit] = useState(50);
  const [sort, setSort] = useState("random");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [trackSearchQuery, setTrackSearchQuery] = useState("");
  const deferredTrackSearchQuery = useDeferredValue(trackSearchQuery);
  const [trackSearchScope, setTrackSearchScope] = useState<"rules" | "library">(
    "rules",
  );
  const [trackSearchResults, setTrackSearchResults] = useState<Track[]>([]);
  const [trackSearching, setTrackSearching] = useState(false);
  const [addingTrackId, setAddingTrackId] = useState<number | null>(null);
  const [draggedTrackId, setDraggedTrackId] = useState<number | null>(null);
  const [refining, setRefining] = useState(false);
  const [applyingRefinement, setApplyingRefinement] = useState(false);
  const [refineProposal, setRefineProposal] =
    useState<RefinementProposal | null>(null);

  useEffect(() => {
    const basePlaylist = surface?.playlist;
    if (!basePlaylist) return;
    setName(basePlaylist.name);
    setDescription(basePlaylist.description || "");
    setCategory(basePlaylist.category || "");
    setFeaturedRank(basePlaylist.featured_rank);
    setIsActive(basePlaylist.is_active);
    setIsCurated(basePlaylist.is_curated);
    setAutoRefresh(basePlaylist.auto_refresh_enabled);
    if (basePlaylist.smart_rules) {
      setRules(basePlaylist.smart_rules.rules || []);
      setMatch(basePlaylist.smart_rules.match || "all");
      setLimit(basePlaylist.smart_rules.limit || 50);
      setSort(basePlaylist.smart_rules.sort || "random");
    } else {
      setRules([]);
      setMatch("all");
      setLimit(50);
      setSort("random");
    }
  }, [surface]);

  const basePlaylist = surface?.playlist ?? null;
  const isSmart = basePlaylist?.is_smart ?? false;
  const persistedSmartRules = basePlaylist?.smart_rules;
  const currentSmartRules = useMemo(
    () => ({
      ...persistedSmartRules,
      match,
      rules: rules.map((rule) =>
        rule.field === "year"
          ? {
              ...rule,
              value: Array.isArray(rule.value)
                ? rule.value.map(String)
                : String(rule.value),
            }
          : rule,
      ),
      limit,
      sort,
    }),
    [persistedSmartRules, limit, match, rules, sort],
  );
  const smartRulesChanged =
    isSmart &&
    (match !== (persistedSmartRules?.match || "all") ||
      limit !== (persistedSmartRules?.limit || 50) ||
      sort !== (persistedSmartRules?.sort || "random") ||
      JSON.stringify(rules) !==
        JSON.stringify(persistedSmartRules?.rules || []));

  useEffect(() => {
    if (!isSmart && trackSearchScope === "rules") {
      setTrackSearchScope("library");
    }
  }, [isSmart, trackSearchScope]);

  useEffect(() => {
    const query = deferredTrackSearchQuery.trim();
    if (!playlist || query.length < 2) {
      setTrackSearchResults([]);
      setTrackSearching(false);
      return;
    }

    let cancelled = false;
    setTrackSearching(true);
    const timeout = window.setTimeout(() => {
      api<TrackSearchResponse>(
        `/api/admin/system-playlists/${id}/track-search?q=${encodeURIComponent(
          query,
        )}&scope=${trackSearchScope}&limit=12`,
      )
        .then((response) => {
          if (!cancelled) setTrackSearchResults(response.tracks || []);
        })
        .catch(() => {
          if (!cancelled) {
            setTrackSearchResults([]);
            toast.error("Track search failed");
          }
        })
        .finally(() => {
          if (!cancelled) setTrackSearching(false);
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [deferredTrackSearchQuery, id, playlist, trackSearchScope]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name,
        description: description || null,
        category: category || null,
        featured_rank: featuredRank,
        is_active: isActive,
        is_curated: isCurated,
      };
      if (isSmart) {
        if (smartRulesChanged) body.smart_rules = currentSmartRules;
        body.auto_refresh_enabled = autoRefresh;
      }
      await api(`/api/admin/system-playlists/${id}`, "PUT", body);
      toast.success("Playlist saved");
      void refetch();
    } catch {
      toast.error("Failed to save playlist");
    } finally {
      setSaving(false);
    }
  }, [
    autoRefresh,
    category,
    description,
    featuredRank,
    id,
    isActive,
    isCurated,
    isSmart,
    smartRulesChanged,
    name,
    currentSmartRules,
    refetch,
  ]);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      if (smartRulesChanged) {
        await api(`/api/admin/system-playlists/${id}`, "PUT", {
          smart_rules: currentSmartRules,
          auto_refresh_enabled: autoRefresh,
        });
        toast.success("Rules saved and generation enqueued");
      } else {
        await api(`/api/admin/system-playlists/${id}/generate`, "POST");
        toast.success("Generation enqueued");
      }
      void refetch();
    } catch {
      toast.error("Failed to enqueue generation");
    } finally {
      setGenerating(false);
    }
  }, [autoRefresh, currentSmartRules, id, refetch, smartRulesChanged]);

  const handlePreview = useCallback(async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      const result = await api<PreviewResult>(
        `/api/admin/system-playlists/${id}/preview`,
        "POST",
        {
          smart_rules: currentSmartRules,
        },
      );
      setPreview(result);
    } catch {
      toast.error("Preview failed");
    } finally {
      setPreviewing(false);
    }
  }, [currentSmartRules, id]);

  const handleGenerateDescription = useCallback(async () => {
    if (!llmAvailable) {
      toast.error(llmUnavailableReason);
      return;
    }
    setDescribing(true);
    try {
      const result = await api<{ description: string }>(
        `/api/admin/system-playlists/${id}/ai-description`,
        "POST",
        {
          apply: false,
          smart_rules: isSmart ? currentSmartRules : null,
        },
      );
      setDescription(result.description);
      toast.success("AI description generated");
    } catch (error) {
      toast.error(apiErrorDetail(error, "Failed to generate description"));
    } finally {
      setDescribing(false);
    }
  }, [currentSmartRules, id, isSmart, llmAvailable, llmUnavailableReason]);

  const handleDuplicate = useCallback(async () => {
    try {
      const result = await api<{ id: number }>(
        `/api/admin/system-playlists/${id}/duplicate`,
        "POST",
      );
      toast.success("Playlist duplicated");
      navigate(`/playlists/${result.id}`);
    } catch {
      toast.error("Failed to duplicate playlist");
    }
  }, [id, navigate]);

  const handleCoverUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setUploadingCover(true);
      try {
        const reader = new FileReader();
        const encoded = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        await api(`/api/admin/system-playlists/${id}`, "PUT", {
          cover_data_url: encoded,
        });
        toast.success("Cover upload started");
        void refetch();
      } catch {
        toast.error("Cover upload failed");
      } finally {
        setUploadingCover(false);
        if (coverInputRef.current) {
          coverInputRef.current.value = "";
        }
      }
    },
    [id, refetch],
  );

  const handleRemoveCover = useCallback(async () => {
    try {
      await api(`/api/admin/system-playlists/${id}`, "PUT", {
        cover_data_url: null,
      });
      toast.success("Cover removed");
      void refetch();
    } catch {
      toast.error("Failed to remove cover");
    }
  }, [id, refetch]);

  const handleAddCandidateTrack = useCallback(
    async (track: Track) => {
      const trackId = track.track_id ?? track.id ?? null;
      setAddingTrackId(trackId);
      try {
        const result = await api<Playlist>(
          `/api/admin/system-playlists/${id}/tracks`,
          "POST",
          { tracks: [playlistTrackPayload(track)] },
        );
        setLiveSurface((current) =>
          current ? { ...current, playlist: result } : current,
        );
        setTrackSearchQuery("");
        setTrackSearchResults([]);
        toast.success("Track added and locked");
        void refetch();
      } catch {
        toast.error("Failed to add track");
      } finally {
        setAddingTrackId(null);
      }
    },
    [id, refetch],
  );

  const handleRemoveTrack = useCallback(
    async (track: Track, fallbackPosition: number) => {
      const position = track.position ?? fallbackPosition;
      try {
        const result = await api<Playlist>(
          `/api/admin/system-playlists/${id}/tracks/${position}`,
          "DELETE",
        );
        setLiveSurface((current) =>
          current ? { ...current, playlist: result } : current,
        );
        toast.success("Track removed");
        void refetch();
      } catch {
        toast.error("Failed to remove track");
      }
    },
    [id, refetch],
  );

  const handleTrackDrop = useCallback(
    async (targetTrackId: number | undefined) => {
      if (
        !playlist ||
        draggedTrackId == null ||
        targetTrackId == null ||
        draggedTrackId === targetTrackId
      ) {
        setDraggedTrackId(null);
        return;
      }
      const ids = playlist.tracks
        .map((track) => track.id)
        .filter((trackId): trackId is number => typeof trackId === "number");
      const fromIndex = ids.indexOf(draggedTrackId);
      const toIndex = ids.indexOf(targetTrackId);
      if (fromIndex < 0 || toIndex < 0) {
        setDraggedTrackId(null);
        return;
      }
      const nextIds = [...ids];
      const [moved] = nextIds.splice(fromIndex, 1);
      if (moved == null) {
        setDraggedTrackId(null);
        return;
      }
      nextIds.splice(toIndex, 0, moved);
      setDraggedTrackId(null);

      try {
        const result = await api<Playlist>(
          `/api/admin/system-playlists/${id}/tracks/reorder`,
          "POST",
          { track_ids: nextIds },
        );
        setLiveSurface((current) =>
          current ? { ...current, playlist: result } : current,
        );
        toast.success("Track order locked");
        void refetch();
      } catch {
        toast.error("Failed to reorder tracks");
      }
    },
    [draggedTrackId, id, playlist, refetch],
  );

  const handleRefineTracklist = useCallback(async () => {
    setRefining(true);
    try {
      const result = await api<RefinementProposal>(
        `/api/admin/system-playlists/${id}/refine`,
        "POST",
      );
      setRefineProposal(result);
      toast.success("Refinement staged for review");
    } catch (error) {
      toast.error(apiErrorDetail(error, "Failed to refine tracklist"));
    } finally {
      setRefining(false);
    }
  }, [id]);

  const handleApplyRefinement = useCallback(async () => {
    if (!refineProposal?.actions.length) return;
    setApplyingRefinement(true);
    try {
      await api(`/api/admin/system-playlists/${id}/refine/apply`, "POST", {
        proposal_id: refineProposal.proposal_id,
        action_ids: refineProposal.actions.map((action) => action.id),
      });
      toast.success("Refinement applied");
      setRefineProposal(null);
      void refetch();
    } catch (error) {
      toast.error(apiErrorDetail(error, "Failed to apply refinement"));
    } finally {
      setApplyingRefinement(false);
    }
  }, [id, refineProposal, refetch]);

  function addRule() {
    setRules((current) => [
      ...current,
      { field: "genre", op: "contains", value: "" },
    ]);
  }

  function removeRule(index: number) {
    setRules((current) =>
      current.filter((_, ruleIndex) => ruleIndex !== index),
    );
  }

  function updateRule(index: number, patch: Partial<SmartRule>) {
    setRules((current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    );
  }

  function updateRuleField(index: number, field: string) {
    const nextOp = getOpsForField(field)[0]?.value ?? "eq";
    updateRule(index, { field, op: nextOp, value: "" });
  }

  if (loading) {
    return (
      <div
        role="status"
        aria-label="Loading playlist editor"
        className="flex items-center justify-center py-24"
      >
        <Loader2
          data-admin-ux="editor-loading"
          aria-hidden="true"
          className="h-6 w-6 animate-spin text-primary"
        />
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        Playlist not found
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <BackLink
        data-admin-ux="editor-back"
        label="Back to playlists"
        onClick={() => navigate("/playlists")}
      />
      <section className="@container rounded-md border border-white/10 bg-panel-surface/95 p-5 shadow-[0_28px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
        <PageHeader
          artwork={
            <PlaylistArtwork
              name={playlist.name}
              coverDataUrl={playlist.cover_data_url}
              tracks={playlist.artwork_tracks}
              className="h-28 w-28 shrink-0 rounded-md border border-white/10 bg-white/[0.03]"
              crateMarkClassName="right-3 top-3 [&_img]:h-4.5 [&_img]:w-4.5"
            />
          }
          actions={
            <PageHeaderActions label="Playlist actions">
              <PageHeaderAction label="Duplicate" onClick={handleDuplicate}>
                <Copy
                  data-admin-ux="editor-duplicate-action"
                  aria-hidden="true"
                />
              </PageHeaderAction>
              {isSmart ? (
                <PageHeaderAction
                  label="Preview"
                  onClick={handlePreview}
                  disabled={previewing}
                  aria-busy={previewing || undefined}
                >
                  {previewing ? (
                    <Loader2
                      data-admin-ux="editor-preview"
                      aria-hidden="true"
                      className="animate-spin"
                    />
                  ) : (
                    <Eye
                      data-admin-ux="editor-preview-action"
                      aria-hidden="true"
                    />
                  )}
                </PageHeaderAction>
              ) : null}
              {isSmart ? (
                <PageHeaderAction
                  label={smartRulesChanged ? "Save + generate" : "Generate"}
                  onClick={handleGenerate}
                  disabled={generating}
                  aria-busy={generating || undefined}
                >
                  {generating ? (
                    <Loader2
                      data-admin-ux="editor-generate"
                      aria-hidden="true"
                      className="animate-spin"
                    />
                  ) : (
                    <ListRestart
                      data-admin-ux="editor-generate-action"
                      aria-hidden="true"
                    />
                  )}
                </PageHeaderAction>
              ) : null}
              <PageHeaderAction
                label="Save changes"
                onClick={handleSave}
                disabled={saving}
                aria-busy={saving || undefined}
              >
                {saving ? (
                  <Loader2
                    data-admin-ux="editor-save"
                    aria-hidden="true"
                    className="animate-spin"
                  />
                ) : (
                  <Save data-admin-ux="editor-save-action" aria-hidden="true" />
                )}
              </PageHeaderAction>
            </PageHeaderActions>
          }
          title={name || playlist.name}
          subtitle={
            description ||
            "No editorial description yet. Add one so the playlist reads like a first-class surface in listen."
          }
          eyebrow={
            <div className="flex flex-wrap gap-2">
              <InfoBadge active={isSmart}>
                {isSmart ? "smart" : "static"}
              </InfoBadge>
              <InfoBadge>{isCurated ? "curated" : "internal"}</InfoBadge>
              <InfoBadge>{isActive ? "active" : "inactive"}</InfoBadge>
              {isSmart ? (
                <InfoBadge active={autoRefresh}>auto-refresh</InfoBadge>
              ) : null}
              <StatusChip status={playlist.generation_status} />
            </div>
          }
          meta={
            <>
              <div className="flex flex-wrap gap-1.5">
                <InfoBadge>{playlist.track_count} tracks</InfoBadge>
                <InfoBadge>{formatMinutes(playlist.total_duration)}</InfoBadge>
                <InfoBadge>
                  {playlist.follower_count} follower
                  {playlist.follower_count === 1 ? "" : "s"}
                </InfoBadge>
                {category ? <InfoBadge>{category}</InfoBadge> : null}
                {featuredRank != null ? (
                  <InfoBadge>Rank {featuredRank}</InfoBadge>
                ) : null}
                {playlist.last_generated_at ? (
                  <InfoBadge>
                    Generated {timeAgo(playlist.last_generated_at)}
                  </InfoBadge>
                ) : null}
              </div>

              {playlist.generation_error ? (
                <div className="rounded-md border border-state-warning/20 bg-state-warning/10 px-3 py-2 text-sm text-state-warning-text">
                  {playlist.generation_error}
                </div>
              ) : null}
            </>
          }
        />
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Card className="border-white/10 bg-card">
            <CardHeader className="space-y-1">
              <CardTitle className="text-base">Editorial</CardTitle>
              <p className="text-sm text-muted-foreground">
                Core metadata and visibility settings for how this playlist
                behaves across the product.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_220px_160px]">
                <Field label="Name">
                  <Input
                    aria-label="Name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
                <Field label="Category">
                  <AdminSelect
                    placeholder="Category"
                    value={category}
                    onChange={setCategory}
                    options={[
                      { value: "", label: "None" },
                      ...CATEGORY_OPTIONS,
                    ]}
                    allowClear={false}
                    triggerClassName="w-full max-w-none"
                  />
                </Field>
                <Field label="Featured rank">
                  <Input
                    aria-label="Featured rank"
                    type="number"
                    value={featuredRank ?? ""}
                    onChange={(event) =>
                      setFeaturedRank(
                        event.target.value ? Number(event.target.value) : null,
                      )
                    }
                    placeholder="Optional"
                  />
                </Field>
              </div>

              <Field label="Description">
                <Textarea
                  aria-label="Description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={5}
                  placeholder="Editorial description shown in listen"
                />
                <div className="flex justify-end">
                  <AIButton
                    actionId="playlists.description.generate"
                    type="button"
                    onClick={handleGenerateDescription}
                    loading={describing}
                    disabled={describing || !name.trim() || !llmAvailable}
                    title={!llmAvailable ? llmUnavailableReason : undefined}
                  >
                    Generate description with AI
                  </AIButton>
                </div>
              </Field>

              <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
                <TogglePill
                  label="Active"
                  active={isActive}
                  onClick={() => setIsActive((value) => !value)}
                />
                <TogglePill
                  label="Curated in listen"
                  active={isCurated}
                  onClick={() => setIsCurated((value) => !value)}
                />
                {isSmart ? (
                  <TogglePill
                    label="Auto-refresh daily"
                    active={autoRefresh}
                    onClick={() => setAutoRefresh((value) => !value)}
                  />
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card">
            <CardHeader className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                Cover
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Upload a clean image-only hero asset. Listen renders the
                playlist title, description and metadata on top.
              </p>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-5 md:flex-row md:items-start">
                <PlaylistArtwork
                  name={playlist.name}
                  coverDataUrl={playlist.cover_data_url}
                  tracks={playlist.artwork_tracks}
                  className="h-28 w-28 shrink-0 rounded-md border border-white/10 bg-white/[0.03]"
                  crateMarkClassName="right-3 top-3 [&_img]:h-4.5 [&_img]:w-4.5"
                />

                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <InfoBadge>
                      {playlist.cover_data_url
                        ? "Manual cover active"
                        : "Using auto-collage"}
                    </InfoBadge>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    Keep text out of the image itself; the public playlist page
                    composes the typography and metadata in the hero layout.
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <input
                      ref={coverInputRef}
                      type="file"
                      aria-label="Cover image"
                      accept="image/*"
                      onChange={handleCoverUpload}
                      className="hidden"
                    />
                    <Button
                      className="min-h-11"
                      variant="outline"
                      size="sm"
                      onClick={() => coverInputRef.current?.click()}
                      disabled={uploadingCover}
                    >
                      {uploadingCover ? (
                        <Loader2
                          data-admin-ux="editor-cover-upload"
                          aria-hidden="true"
                          size={14}
                          className="mr-1 animate-spin"
                        />
                      ) : null}
                      {playlist.cover_data_url
                        ? "Replace cover"
                        : "Upload cover"}
                    </Button>
                    {playlist.cover_data_url ? (
                      <Button
                        variant="outline"
                        size="icon-lg"
                        onClick={handleRemoveCover}
                        aria-label="Remove cover"
                        title="Remove cover"
                      >
                        <Trash2
                          data-admin-ux="editor-remove-cover"
                          aria-hidden="true"
                        />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {isSmart ? (
            <Card className="border-white/10 bg-card">
              <CardHeader className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  Smart rules
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Keep the builder dense, but readable: editorial intent first,
                  then execution details and preview.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-[180px_120px_180px]">
                  <Field label="Match">
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

                  <Field label="Limit">
                    <Input
                      aria-label="Limit"
                      type="number"
                      min={1}
                      max={500}
                      value={limit}
                      onChange={(event) =>
                        setLimit(Number(event.target.value) || 50)
                      }
                    />
                  </Field>

                  <Field label="Sort">
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

                <div className="space-y-3">
                  {rules.map((rule, index) => {
                    const dropdownConfig = DROPDOWN_FIELDS[rule.field];
                    const dropdownOptions =
                      dropdownConfig && filterOptions
                        ? filterOptions[dropdownConfig.optionsKey].map(
                            (value) => ({ value, label: value }),
                          )
                        : [];
                    const ops = getOpsForField(rule.field);

                    return (
                      <div
                        key={index}
                        className="@container rounded-md border border-white/10 bg-black/10 p-3"
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <InfoBadge>Rule {index + 1}</InfoBadge>
                          <Button
                            type="button"
                            size="icon-lg"
                            variant="ghost"
                            aria-label={`Remove rule ${index + 1}`}
                            onClick={() => removeRule(index)}
                            title={`Remove rule ${index + 1}`}
                          >
                            <Trash2
                              data-admin-ux="editor-remove-rule"
                              aria-hidden="true"
                            />
                          </Button>
                        </div>

                        <div className="grid gap-3 @xl:grid-cols-[180px_160px_minmax(0,1fr)]">
                          <Field label="Field">
                            <AdminSelect
                              value={rule.field}
                              onChange={(value) =>
                                updateRuleField(index, value)
                              }
                              options={RULE_FIELDS.map((field) => ({
                                value: field.value,
                                label: field.label,
                              }))}
                              allowClear={false}
                              placeholder="Field"
                              triggerClassName="w-full max-w-none"
                            />
                          </Field>

                          <Field label="Operator">
                            <AdminSelect
                              value={rule.op}
                              onChange={(value) =>
                                updateRule(index, { op: value, value: "" })
                              }
                              options={ops}
                              allowClear={false}
                              placeholder="Operator"
                              triggerClassName="w-full max-w-none"
                            />
                          </Field>

                          <Field label="Value">
                            {rule.op === "between" ? (
                              <div className="grid gap-3 sm:grid-cols-2">
                                <Input
                                  aria-label={`Rule ${index + 1} minimum`}
                                  type="number"
                                  value={
                                    Array.isArray(rule.value)
                                      ? String(rule.value[0] ?? "")
                                      : ""
                                  }
                                  placeholder="Minimum"
                                  onChange={(event) =>
                                    updateRule(index, {
                                      value: [
                                        numericRuleInput(
                                          rule.field,
                                          event.target.value,
                                        ),
                                        numericRuleInput(
                                          rule.field,
                                          String(
                                            Array.isArray(rule.value)
                                              ? (rule.value[1] ?? "")
                                              : "",
                                          ),
                                        ),
                                      ],
                                    })
                                  }
                                />
                                <Input
                                  aria-label={`Rule ${index + 1} maximum`}
                                  type="number"
                                  value={
                                    Array.isArray(rule.value)
                                      ? String(rule.value[1] ?? "")
                                      : ""
                                  }
                                  placeholder="Maximum"
                                  onChange={(event) =>
                                    updateRule(index, {
                                      value: [
                                        numericRuleInput(
                                          rule.field,
                                          String(
                                            Array.isArray(rule.value)
                                              ? (rule.value[0] ?? "")
                                              : "",
                                          ),
                                        ),
                                        numericRuleInput(
                                          rule.field,
                                          event.target.value,
                                        ),
                                      ],
                                    })
                                  }
                                />
                              </div>
                            ) : dropdownConfig ? (
                              <AdminSelect
                                value={String(rule.value ?? "")}
                                onChange={(value) =>
                                  updateRule(index, { value })
                                }
                                options={dropdownOptions}
                                placeholder={dropdownConfig.placeholder}
                                searchable
                                searchPlaceholder={
                                  dropdownConfig.searchPlaceholder
                                }
                                allowClear={false}
                                triggerClassName="w-full max-w-none"
                              />
                            ) : (
                              <Input
                                aria-label={`Rule ${index + 1} value`}
                                value={String(rule.value ?? "")}
                                placeholder="Value"
                                onChange={(event) =>
                                  updateRule(index, {
                                    value:
                                      getFieldType(rule.field) === "number"
                                        ? numericRuleInput(
                                            rule.field,
                                            event.target.value,
                                          )
                                        : event.target.value,
                                  })
                                }
                              />
                            )}
                          </Field>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                  <p className="text-sm text-muted-foreground">
                    Use preview to sanity-check the shape of the result before
                    saving or generating again.
                  </p>
                  <Button
                    className="min-h-11"
                    variant="outline"
                    size="sm"
                    onClick={addRule}
                  >
                    Add rule
                  </Button>
                </div>

                {preview ? (
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <InfoBadge active>
                        {preview.total_matching} matching tracks
                      </InfoBadge>
                      <InfoBadge>
                        {formatMinutes(preview.duration_total_sec)}
                      </InfoBadge>
                      {preview.avg_year ? (
                        <InfoBadge>Avg year {preview.avg_year}</InfoBadge>
                      ) : null}
                      {preview.year_range ? (
                        <InfoBadge>
                          {preview.year_range[0]}-{preview.year_range[1]}
                        </InfoBadge>
                      ) : null}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-primary/10 pt-4">
                      <p className="max-w-2xl text-sm text-muted-foreground">
                        Preview is only a simulation. It does not replace the
                        playlist tracks until you generate the playlist with
                        these rules.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {smartRulesChanged ? (
                          <Button
                            className="min-h-11"
                            variant="outline"
                            size="sm"
                            onClick={handleSave}
                            disabled={saving}
                          >
                            {saving ? (
                              <Loader2
                                data-admin-ux="editor-save-rules"
                                aria-hidden="true"
                                size={14}
                                className="mr-1 animate-spin"
                              />
                            ) : null}
                            Save rules
                          </Button>
                        ) : null}
                        <Button
                          className="min-h-11"
                          size="sm"
                          onClick={handleGenerate}
                          disabled={generating}
                        >
                          {generating ? (
                            <Loader2
                              data-admin-ux="editor-apply-preview"
                              aria-hidden="true"
                              size={14}
                              className="mr-1 animate-spin"
                            />
                          ) : null}
                          {smartRulesChanged
                            ? "Apply preview to playlist"
                            : "Generate playlist"}
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <DistributionBlock
                        label="Top genres"
                        items={Object.entries(preview.genre_distribution).slice(
                          0,
                          10,
                        )}
                      />
                      <DistributionBlock
                        label="Top artists"
                        items={Object.entries(
                          preview.artist_distribution,
                        ).slice(0, 8)}
                      />
                    </div>

                    {preview.tracks.length > 0 ? (
                      <div className="mt-4 border-t border-primary/10 pt-4">
                        <div className="mb-2 font-mono font-normal text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                          Matching track sample
                        </div>
                        <div className="space-y-1.5">
                          {preview.tracks.slice(0, 8).map((track, index) => (
                            <div
                              key={`${track.artist ?? "artist"}-${
                                track.album ?? "album"
                              }-${track.title ?? "track"}`}
                              className="flex items-center gap-3 rounded-md px-2 py-2 "
                            >
                              <span className="w-6 text-right font-mono font-normal text-xs text-muted-foreground">
                                {index + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">
                                  {track.title || "Untitled"}
                                </div>
                                <div className="truncate text-xs text-muted-foreground">
                                  {[track.artist, track.album]
                                    .filter(Boolean)
                                    .join(" — ")}
                                </div>
                              </div>
                              <div className="flex shrink-0 gap-1.5">
                                {track.format ? (
                                  <InfoBadge>{track.format}</InfoBadge>
                                ) : null}
                                {track.year ? (
                                  <InfoBadge>{track.year}</InfoBadge>
                                ) : null}
                                {track.duration != null ? (
                                  <InfoBadge>
                                    {formatTrackDuration(track.duration)}
                                  </InfoBadge>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-white/10 bg-card">
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    Tracks
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Curate the generated snapshot. Manual adds and dragged rows
                    are locked against future auto-refreshes.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={handleRefineTracklist}
                  disabled={refining || (playlist.tracks?.length ?? 0) === 0}
                >
                  {refining
                    ? "Preparing refinements..."
                    : "Suggest refinements"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-md border border-primary/15 bg-primary/[0.04] p-3">
                <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                  <Field label="Search tracks">
                    <div className="relative">
                      <Search
                        data-admin-ux="editor-search"
                        aria-hidden="true"
                        size={14}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35"
                      />
                      <Input
                        aria-label="Search tracks"
                        value={trackSearchQuery}
                        onChange={(event) =>
                          setTrackSearchQuery(event.target.value)
                        }
                        placeholder={
                          isSmart && trackSearchScope === "rules"
                            ? "Search tracks matching this playlist..."
                            : "Search library tracks..."
                        }
                        className="border-white/10 bg-black/25 pl-9"
                      />
                    </div>
                  </Field>
                  <Field label="Search scope">
                    <AdminSelect
                      placeholder="Search scope"
                      value={trackSearchScope}
                      onChange={(value) =>
                        setTrackSearchScope(value as "rules" | "library")
                      }
                      options={[
                        {
                          value: "rules",
                          label: "Matching rules",
                        },
                        { value: "library", label: "Entire library" },
                      ]}
                      allowClear={false}
                      disabled={!isSmart}
                      triggerClassName="w-full max-w-none"
                    />
                  </Field>
                </div>

                {trackSearching ? (
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2
                      data-admin-ux="editor-search-loading"
                      aria-hidden="true"
                      size={13}
                      className="animate-spin"
                    />{" "}
                    Searching candidates...
                  </div>
                ) : trackSearchResults.length > 0 ? (
                  <div className="mt-3 space-y-1.5 border-t border-primary/10 pt-3">
                    {trackSearchResults.map((track) => {
                      const trackId = track.track_id ?? track.id ?? 0;
                      return (
                        <div
                          key={`${trackId}-${track.title}`}
                          className="flex items-center gap-3 rounded-md border border-white/8 bg-black/20 px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">
                              {track.title || "Untitled"}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {[track.artist, track.album]
                                .filter(Boolean)
                                .join(" — ")}
                            </div>
                          </div>
                          {track.duration != null ? (
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {formatTrackDuration(track.duration)}
                            </span>
                          ) : null}
                          <Button
                            className="min-h-11"
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={addingTrackId === trackId}
                            onClick={() => void handleAddCandidateTrack(track)}
                          >
                            {addingTrackId === trackId ? (
                              <Loader2
                                data-admin-ux="editor-add-track"
                                aria-hidden="true"
                                size={13}
                                className="mr-1.5 animate-spin"
                              />
                            ) : null}
                            Add locked
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : deferredTrackSearchQuery.trim().length >= 2 ? (
                  <div className="mt-3 rounded-md border border-dashed border-white/10 bg-black/15 px-3 py-4 text-center text-xs text-muted-foreground">
                    No candidate tracks found in this scope.
                  </div>
                ) : null}
              </div>

              {refineProposal ? (
                <div className="rounded-md border border-primary/25 bg-primary/[0.06] p-4 shadow-none">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                        Editorial refinement proposal
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {refineProposal.summary}
                      </p>
                    </div>
                    {refineProposal.actions.length > 0 ? (
                      <Button
                        className="min-h-11"
                        size="sm"
                        onClick={handleApplyRefinement}
                        disabled={applyingRefinement}
                      >
                        {applyingRefinement ? (
                          <Loader2
                            data-admin-ux="editor-apply-refinement"
                            aria-hidden="true"
                            size={14}
                            className="mr-1 animate-spin"
                          />
                        ) : null}
                        Apply safe fixes
                      </Button>
                    ) : null}
                    <Button
                      className="min-h-11"
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setRefineProposal(null)}
                    >
                      Dismiss
                    </Button>
                  </div>

                  {refineProposal.issues.length > 0 ? (
                    <div className="mt-4 grid gap-2">
                      {refineProposal.issues.slice(0, 8).map((issue) => (
                        <div
                          key={`${issue.type}-${issue.positions.join("-")}`}
                          className="rounded-md border border-white/10 bg-black/20 px-3 py-2"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <SeverityMeter
                              level={issue.severity}
                              label={issue.severity}
                            />
                            <span className="text-sm">{issue.message}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {refineProposal.actions.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {refineProposal.actions.slice(0, 10).map((action) => (
                        <InfoBadge key={action.id}>{action.label}</InfoBadge>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {playlist.tracks?.length > 0 ? (
                <div className="space-y-1.5">
                  {playlist.tracks.map((track, index) => {
                    const rowId = track.id;
                    return (
                      <div
                        key={
                          rowId ??
                          `${track.artist}-${track.album}-${track.title}`
                        }
                        draggable={typeof rowId === "number"}
                        onDragStart={() => {
                          if (typeof rowId === "number") {
                            setDraggedTrackId(rowId);
                          }
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => void handleTrackDrop(rowId)}
                        onDragEnd={() => setDraggedTrackId(null)}
                        className={
                          "group flex items-center gap-3 rounded-md border border-transparent px-2 py-2 transition-colors hover:border-white/10  " +
                          (draggedTrackId === rowId
                            ? "bg-primary/10"
                            : "bg-transparent")
                        }
                      >
                        <GripVertical
                          data-admin-ux="editor-drag"
                          aria-hidden="true"
                          size={14}
                          className="shrink-0 cursor-grab text-white/25 group-hover:text-white/55"
                        />
                        <span className="w-6 text-right font-mono font-normal text-xs text-muted-foreground">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {track.title}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {track.artist} — {track.album}
                          </div>
                        </div>
                        <div className="hidden shrink-0 gap-1.5 xl:flex">
                          <InfoBadge active={Boolean(track.locked)}>
                            {trackSourceLabel(track)}
                          </InfoBadge>
                          {track.format ? (
                            <InfoBadge>{track.format}</InfoBadge>
                          ) : null}
                        </div>
                        {track.duration != null ? (
                          <span className="w-12 text-right font-mono font-normal text-xs tabular-nums text-muted-foreground">
                            {formatTrackDuration(track.duration)}
                          </span>
                        ) : null}
                        <Button
                          type="button"
                          size="icon-lg"
                          variant="ghost"
                          aria-label={`Remove ${track.title}`}
                          onClick={() =>
                            void handleRemoveTrack(track, index + 1)
                          }
                          title={`Remove ${track.title}`}
                        >
                          <Trash2
                            data-admin-ux="editor-remove-track"
                            aria-hidden="true"
                          />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-white/10 bg-black/10 px-4 py-8 text-center text-sm text-muted-foreground">
                  {isSmart
                    ? "No generated tracks yet. Run a generation once the rule set is ready."
                    : "No tracks in this playlist yet."}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="border-white/10 bg-card">
            <CardHeader className="space-y-1">
              <CardTitle className="text-sm uppercase tracking-[0.12em] text-muted-foreground">
                Status
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              <MetricTile label="Tracks" value={playlist.track_count} />
              <MetricTile
                label="Duration"
                value={formatMinutes(playlist.total_duration || 0)}
              />
              <MetricTile label="Followers" value={playlist.follower_count} />
              <MetricTile
                label="Last generated"
                value={
                  playlist.last_generated_at
                    ? timeAgo(playlist.last_generated_at)
                    : "Never"
                }
              />
            </CardContent>
          </Card>

          {history && history.length > 0 ? (
            <Card className="border-white/10 bg-card">
              <CardHeader className="space-y-1">
                <CardTitle className="text-sm uppercase tracking-[0.12em] text-muted-foreground">
                  Generation history
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {history.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-md border border-white/10 bg-black/10 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <StatusChip status={entry.status} />
                        <span className="font-mono font-normal text-sm">
                          {timeAgo(entry.started_at)}
                        </span>
                      </div>
                      {entry.track_count != null ? (
                        <span className="font-mono font-normal text-xs tabular-nums text-muted-foreground">
                          {entry.track_count} tracks
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 font-mono font-normal text-xs text-muted-foreground">
                      {entry.triggered_by}
                      {entry.duration_sec != null
                        ? ` · ${Math.round(entry.duration_sec)}s`
                        : ""}
                    </div>
                    {entry.error ? (
                      <div className="mt-2 text-xs text-state-warning-text">
                        {entry.error}
                      </div>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
