import { PageHeaderLayout } from "@crate/ui/domain/navigation/PageHeader";
import { BackLink } from "@crate/ui/domain/navigation/BackLink";
import { FilterChip } from "@crate/ui/primitives/FilterChip";
import { HairlineList, HairlineRow } from "@crate/ui/primitives/HairlineList";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { ActionButton, ActionGroup } from "@crate/ui/primitives/ActionGroup";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { FormField } from "@crate/ui/primitives/FormField";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import { EmptyState, ErrorState, LoadingState } from "@crate/ui/domain/states";
import { OpsRefreshNotice } from "@/components/admin/ops-surfaces";
import { RelativeTime } from "@/components/admin/RelativeTime";
import { PlaylistEditorTrackList } from "@/components/playlists/PlaylistEditorTrackList";
import { PlaylistTrackRequirements } from "@/components/playlists/PlaylistTrackRequirements";
import {
  serializePlaylistEditorDraft,
  usePlaylistEditorDraft,
  type PlaylistRuleDraft,
} from "@/components/playlists/use-playlist-editor-draft";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import {
  PageHeaderAction,
  PageHeaderActions,
} from "@/components/layout/PageHeader";
import { SeverityMeter } from "@/components/admin/status-indicators";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useNavigate, useParams } from "react-router";
import {
  Camera,
  Copy,
  Eye,
  RefreshCw as ListRestart,
  Loader2,
  Save,
  Trash2,
} from "@crate/ui/icons";
import { toast } from "sonner";

import { AdminSelect } from "@/components/ui/AdminSelect";
import { AIButton } from "@/components/ui/AIButton";
import { useSnapshotStream } from "@/hooks/use-snapshot-stream";
import {
  PlaylistArtwork,
  type PlaylistArtworkTrack,
} from "@/components/playlists/PlaylistArtwork";

import { Button } from "@crate/ui/shadcn/button";
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
  require_full_mix_profile?: boolean;
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

function GenerationPhaseLine({
  status,
  lastGeneratedAt,
  streamStatus,
}: {
  status: string;
  lastGeneratedAt: string | null;
  streamStatus: ReturnType<typeof useSnapshotStream>;
}) {
  const phaseIndex =
    status === "queued"
      ? 0
      : status === "running" || status === "failed"
        ? 1
        : lastGeneratedAt
          ? 2
          : -1;
  const labels = ["Queued", "Generating", "Ready"];
  const streamCopy =
    streamStatus === "live"
      ? "Live updates"
      : streamStatus === "reconnecting"
        ? "Reconnecting"
        : streamStatus === "connecting"
          ? "Connecting"
          : "Stream paused";

  return (
    <div
      role="status"
      aria-label="Playlist generation progress"
      data-generation-phase-line
      className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-border-quiet pt-4"
    >
      <ol className="flex min-w-0 flex-1 items-center">
        {labels.map((label, index) => {
          const isCurrent = index === phaseIndex;
          const isComplete = phaseIndex > index;
          const failed = isCurrent && status === "failed";
          const stepLabel = failed ? "Failed" : label;
          const tone =
            isComplete || (isCurrent && !failed)
              ? "on"
              : failed
                ? "warn"
                : "off";

          return (
            <li
              key={label}
              aria-current={isCurrent ? "step" : undefined}
              className="flex min-w-0 flex-1 items-center last:flex-none"
            >
              <StatusDot
                tone={tone}
                label={stepLabel}
                pulse={
                  isCurrent && (status === "queued" || status === "running")
                }
                className="whitespace-nowrap"
              />
              {index < labels.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={`mx-3 h-px min-w-2 flex-1 ${isComplete ? "bg-accent-action/45" : "bg-border-quiet"}`}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <StatusDot
        label={streamCopy}
        tone={streamStatus === "live" ? "on" : "off"}
        pulse={streamStatus === "connecting" || streamStatus === "reconnecting"}
      />
    </div>
  );
}

function formatRuleValue(rule: SmartRule): string {
  if (Array.isArray(rule.value)) {
    const [minimum, maximum] = rule.value;
    return `${minimum ?? "…"}–${maximum ?? "…"}`;
  }
  return String(rule.value ?? "").trim() || "Any value";
}

function RuleExpression({ rule, index }: { rule: SmartRule; index: number }) {
  const field = RULE_FIELDS.find((candidate) => candidate.value === rule.field);
  const operatorLabels: Record<string, string> = {
    eq: "=",
    neq: "≠",
    contains: "CONTAINS",
    not_contains: "NOT CONTAINS",
    gte: "≥",
    lte: "≤",
    between: "BETWEEN",
  };
  const operator = operatorLabels[rule.op] ?? rule.op;

  return (
    <div
      role="group"
      aria-label={`Rule ${index + 1}: ${field?.label ?? rule.field} ${operator} ${formatRuleValue(rule)}`}
      className="flex min-w-0 flex-wrap items-center gap-1.5"
    >
      <InfoBadge>{field?.label ?? rule.field}</InfoBadge>
      <MonoLabel as="span" className="px-1">
        {operator}
      </MonoLabel>
      <InfoBadge className="max-w-full truncate">
        {formatRuleValue(rule)}
      </InfoBadge>
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
            {name} <span className="text-text-subtle">{count}</span>
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
    error: loadError,
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

  const activeSurface =
    liveSurface?.playlist.id === id
      ? liveSurface
      : surface?.playlist.id === id
        ? surface
        : null;
  const playlist = activeSurface?.playlist ?? null;
  const history = activeSurface?.history ?? [];

  useEffect(() => {
    if (surface?.playlist.id === id) setLiveSurface(surface);
  }, [id, surface]);

  const acceptLiveSurface = useCallback(
    (payload: PlaylistEditorSurface) => {
      if (payload.playlist.id === id) setLiveSurface(payload);
    },
    [id],
  );
  const streamStatus = useSnapshotStream<PlaylistEditorSurface>(
    id ? apiSseUrl(`/api/admin/system-playlists/${id}/stream`) : null,
    acceptLiveSurface,
  );

  const { draft, setField, dirtyFields, isDirty, acceptSaved } =
    usePlaylistEditorDraft(id, playlist);
  const {
    name,
    description,
    category,
    featuredRank,
    isActive,
    isCurated,
    autoRefresh,
    rules,
    match,
    limit,
    sort,
    requireFullMixProfile,
  } = draft;
  const [validatedScope, setValidatedScope] = useState<"all" | "rules" | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const previewRequest = useRef(0);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [removingCover, setRemovingCover] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [trackSearchQuery, setTrackSearchQuery] = useState("");
  const deferredTrackSearchQuery = useDeferredValue(trackSearchQuery);
  const [trackSearchScope, setTrackSearchScope] = useState<"rules" | "library">(
    "rules",
  );
  const [trackSearchResults, setTrackSearchResults] = useState<Track[]>([]);
  const [trackSearchError, setTrackSearchError] = useState<string | null>(null);
  const [searchRetry, setSearchRetry] = useState(0);
  const [trackSearching, setTrackSearching] = useState(false);
  const [addingTrackId, setAddingTrackId] = useState<number | null>(null);
  const [refining, setRefining] = useState(false);
  const [applyingRefinement, setApplyingRefinement] = useState(false);
  const [refineProposal, setRefineProposal] =
    useState<RefinementProposal | null>(null);

  const basePlaylist = playlist;
  const isSmart = basePlaylist?.is_smart ?? false;
  const isStaticPlaylist = basePlaylist !== null && !isSmart;
  const persistedSmartRules = basePlaylist?.smart_rules;
  const smartRulesChanged =
    isSmart &&
    ["rules", "match", "limit", "sort", "requireFullMixProfile"].some((key) =>
      dirtyFields.has(key as keyof typeof draft),
    );
  const allValidation = useMemo(
    () =>
      serializePlaylistEditorDraft(draft, {
        isSmart: isSmart && smartRulesChanged,
        persistedSmartRules,
        scope: "all",
      }),
    [draft, isSmart, smartRulesChanged, persistedSmartRules],
  );
  const rulesValidation = useMemo(
    () =>
      serializePlaylistEditorDraft(draft, {
        isSmart,
        persistedSmartRules,
        scope: "rules",
      }),
    [draft, isSmart, persistedSmartRules],
  );
  const currentSmartRules = rulesValidation.valid
    ? rulesValidation.smartRules
    : null;
  const currentPreviewKey = currentSmartRules
    ? JSON.stringify(currentSmartRules)
    : null;
  const previewStale = preview !== null && previewKey !== currentPreviewKey;
  const validation =
    validatedScope === "rules" ? rulesValidation : allValidation;
  const fieldError = (key: string) =>
    validatedScope && !validation.valid ? validation.errors[key] : undefined;
  const validate = (scope: "all" | "rules") => {
    const result = scope === "all" ? allValidation : rulesValidation;
    setValidatedScope(scope);
    if (!result.valid)
      toast.error("Check the highlighted fields before continuing.");
    return result;
  };
  useEffect(() => {
    previewRequest.current += 1;
    setPreview(null);
    setPreviewKey(null);
    setPreviewing(false);
    setValidatedScope(null);
    setRefineProposal(null);
    setTrackSearchQuery("");
  }, [id]);

  useEffect(() => {
    if (isStaticPlaylist && trackSearchScope === "rules") {
      setTrackSearchScope("library");
    }
  }, [isStaticPlaylist, trackSearchScope]);

  useEffect(() => {
    const query = deferredTrackSearchQuery.trim();
    if (!playlist || query.length < 2) {
      setTrackSearchResults([]);
      setTrackSearchError(null);
      setTrackSearching(false);
      return;
    }

    let cancelled = false;
    setTrackSearching(true);
    setTrackSearchError(null);
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
            setTrackSearchError("Could not search tracks. Try again.");
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
  }, [deferredTrackSearchQuery, id, !!playlist, trackSearchScope, searchRetry]);

  const handleSave = async () => {
    const result = validate("all");
    if (!result.valid) return;
    const sent = structuredClone(draft);
    setSaving(true);
    try {
      const body = {
        ...result.payload,
        ...(isSmart ? { auto_refresh_enabled: autoRefresh } : {}),
      };
      if (isSmart && !smartRulesChanged) delete body.smart_rules;
      await api(`/api/admin/system-playlists/${id}`, "PUT", body);
      acceptSaved(sent);
      toast.success("Playlist saved");
      void refetch();
    } catch {
      toast.error("Failed to save playlist");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    const result = validate("rules");
    if (!result.valid || !isSmart) return;
    const sent = {
      rules: structuredClone(rules),
      match,
      limit,
      sort,
      requireFullMixProfile,
      autoRefresh,
    };
    setGenerating(true);
    try {
      if (smartRulesChanged) {
        await api(`/api/admin/system-playlists/${id}`, "PUT", result.payload);
      } else {
        if (dirtyFields.has("autoRefresh")) {
          await api(`/api/admin/system-playlists/${id}`, "PUT", {
            auto_refresh_enabled: autoRefresh,
          });
        }
        await api(`/api/admin/system-playlists/${id}/generate`, "POST");
      }
      acceptSaved(sent);
      toast.success("Generation enqueued");
      void refetch();
    } catch {
      toast.error("Failed to enqueue generation");
    } finally {
      setGenerating(false);
    }
  };

  const handlePreview = async () => {
    const result = validate("rules");
    if (!result.valid || !result.smartRules) return;
    const request = ++previewRequest.current;
    const key = JSON.stringify(result.smartRules);
    setPreviewing(true);
    try {
      const response = await api<PreviewResult>(
        `/api/admin/system-playlists/${id}/preview`,
        "POST",
        {
          smart_rules: result.smartRules,
        },
      );
      if (request !== previewRequest.current) return;
      setPreview(response);
      setPreviewKey(key);
    } catch {
      if (request === previewRequest.current)
        toast.error("Preview failed. Try again.");
    } finally {
      if (request === previewRequest.current) setPreviewing(false);
    }
  };

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
      setField("description", result.description);
      toast.success("AI description generated");
    } catch (error) {
      toast.error(apiErrorDetail(error, "Failed to generate description"));
    } finally {
      setDescribing(false);
    }
  }, [
    currentSmartRules,
    id,
    isSmart,
    llmAvailable,
    llmUnavailableReason,
    setField,
  ]);

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
        const encoded = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
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
    setRemovingCover(true);
    try {
      await api(`/api/admin/system-playlists/${id}`, "PUT", {
        cover_data_url: null,
      });
      toast.success("Cover removed");
      void refetch();
    } catch {
      toast.error("Failed to remove cover");
    } finally {
      setRemovingCover(false);
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
          current?.playlist.id === id && result.id === id
            ? { ...current, playlist: result }
            : current,
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
          current?.playlist.id === id && result.id === id
            ? { ...current, playlist: result }
            : current,
        );
        toast.success("Track removed");
        void refetch();
      } catch (error) {
        toast.error("Failed to remove track");
        throw error;
      }
    },
    [id, refetch],
  );

  const handleTrackReorder = useCallback(
    async (nextIds: number[]) => {
      try {
        const result = await api<Playlist>(
          `/api/admin/system-playlists/${id}/tracks/reorder`,
          "POST",
          {
            track_ids: nextIds,
          },
        );
        setLiveSurface((current) =>
          current?.playlist.id === id && result.id === id
            ? { ...current, playlist: result }
            : current,
        );
        toast.success("Track order locked");
        void refetch();
      } catch (error) {
        toast.error("Failed to reorder tracks");
        throw error;
      }
    },
    [id, refetch],
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
    setField("rules", (current) => [
      ...current,
      { field: "genre", op: "contains", value: "" },
    ]);
  }

  function removeRule(index: number) {
    setField("rules", (current) =>
      current.filter((_, ruleIndex) => ruleIndex !== index),
    );
  }

  function updateRule(index: number, patch: Partial<PlaylistRuleDraft>) {
    setField("rules", (current) =>
      current.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, ...patch } : rule,
      ),
    );
  }

  function updateRuleField(index: number, field: string) {
    const nextOp = getOpsForField(field)[0]?.value ?? "eq";
    updateRule(index, { field, op: nextOp, value: "" });
  }

  if (loading && !playlist)
    return <LoadingState label="Loading playlist editor" />;
  if (loadError && !playlist)
    return (
      <ErrorState
        message="Could not load the playlist editor."
        onRetry={() => void refetch()}
      />
    );
  if (!playlist)
    return (
      <EmptyState
        title="Playlist not found"
        description="This playlist is unavailable or no longer exists."
        action={
          <BackLink
            label="Back to playlists"
            onClick={() => navigate("/playlists")}
          />
        }
      />
    );

  return (
    <div className="min-w-0 space-y-6">
      <BackLink
        data-admin-ux="editor-back"
        label="Back to playlists"
        onClick={() => navigate("/playlists")}
      />
      <PageHeaderLayout
        as="header"
        aria-labelledby="playlist-editor-title"
        artwork={
          <PlaylistArtwork
            name={playlist.name}
            coverDataUrl={playlist.cover_data_url}
            tracks={playlist.artwork_tracks}
            className="size-28 shrink-0 rounded-md border border-border-quiet object-cover md:size-56"
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
                disabled={previewing || generating || saving}
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
                label={smartRulesChanged ? "Save rules + generate" : "Generate"}
                onClick={handleGenerate}
                disabled={generating || saving}
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
              disabled={saving || generating}
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
      >
        <div className="flex min-h-28 min-w-0 flex-col justify-between gap-3 md:min-h-56 md:gap-4">
          <div className="grid min-w-0 gap-3">
            <div className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto">
              <InfoBadge active={isSmart}>
                {isSmart ? "smart" : "static"}
              </InfoBadge>
              <InfoBadge>{isCurated ? "curated" : "internal"}</InfoBadge>
              <InfoBadge>{isActive ? "active" : "inactive"}</InfoBadge>
              {isSmart ? (
                <InfoBadge active={autoRefresh}>auto-refresh</InfoBadge>
              ) : null}
              {isDirty ? (
                <InfoBadge tone="warning">Unsaved changes</InfoBadge>
              ) : null}
            </div>
            <div className="grid min-w-0 gap-2">
              <h1
                id="playlist-editor-title"
                className="crate-page-title min-w-0 wrap-anywhere"
              >
                {name || playlist.name}
              </h1>
              <p className="m-0 line-clamp-2 max-w-3xl font-[family-name:var(--font-brand)] text-sm font-normal leading-6 text-text-muted md:line-clamp-3">
                {description ||
                  "No editorial description yet. Add one so the playlist reads like a first-class surface in listen."}
              </p>
            </div>
          </div>
          <div className="flex min-w-0 flex-nowrap gap-1.5 overflow-x-auto">
            <InfoBadge>{playlist.track_count} tracks</InfoBadge>
            <InfoBadge>{formatMinutes(playlist.total_duration)}</InfoBadge>
            <InfoBadge>
              {playlist.follower_count} follower
              {playlist.follower_count === 1 ? "" : "s"}
            </InfoBadge>
            {category ? <InfoBadge>{category}</InfoBadge> : null}
            {featuredRank !== "" ? (
              <InfoBadge>Rank {featuredRank}</InfoBadge>
            ) : null}
            {playlist.last_generated_at ? (
              <InfoBadge>
                Generated {timeAgo(playlist.last_generated_at)}
              </InfoBadge>
            ) : null}
          </div>
        </div>
      </PageHeaderLayout>
      {loadError ? (
        <OpsRefreshNotice
          message="Could not refresh the playlist. Your pending edits are preserved."
          onRetry={() => void refetch()}
          retrying={loading}
        />
      ) : null}
      {playlist.generation_error ? (
        <ErrorState
          message={playlist.generation_error}
          onRetry={isSmart ? handleGenerate : undefined}
        />
      ) : null}
      {isSmart ? (
        <GenerationPhaseLine
          status={playlist.generation_status}
          lastGeneratedAt={playlist.last_generated_at}
          streamStatus={streamStatus}
        />
      ) : null}

      <div className="min-w-0 space-y-8">
        <InstrumentPanel
          as="section"
          headingLevel={2}
          label={{ children: "Editorial data", tone: "accent" }}
          description="Edit the playlist identity, cover and visibility. Save changes applies these settings together."
        >
          <div className="grid min-w-0 gap-6 @3xl:grid-cols-[176px_minmax(0,1fr)]">
            <div className="min-w-0 space-y-3">
              <MonoLabel as="p">Cover image</MonoLabel>
              <div className="relative w-44 max-w-full">
                <PlaylistArtwork
                  name={playlist.name}
                  coverDataUrl={playlist.cover_data_url}
                  tracks={playlist.artwork_tracks}
                  className="aspect-square w-full rounded-md"
                />
                <div className="absolute bottom-1 right-1">
                  <ActionGroup label="Cover actions">
                    <ActionButton
                      label={
                        playlist.cover_data_url
                          ? "Replace cover"
                          : "Upload cover"
                      }
                      loading={uploadingCover}
                      disabled={removingCover}
                      onClick={() => coverInputRef.current?.click()}
                    >
                      <Camera
                        data-admin-ux="editor-edit-cover"
                        aria-hidden="true"
                      />
                    </ActionButton>
                    {playlist.cover_data_url ? (
                      <ActionButton
                        label="Remove cover"
                        tooltip="Remove cover"
                        loading={removingCover}
                        disabled={uploadingCover}
                        onClick={() => void handleRemoveCover()}
                      >
                        <Trash2
                          data-admin-ux="editor-remove-cover"
                          aria-hidden="true"
                        />
                      </ActionButton>
                    ) : null}
                  </ActionGroup>
                </div>
              </div>
              <input
                ref={coverInputRef}
                type="file"
                aria-label="Cover image"
                accept="image/*"
                onChange={handleCoverUpload}
                className="hidden"
              />
              <p className="text-sm text-text-muted">
                {playlist.cover_data_url
                  ? "Manual cover"
                  : "Automatic album collage"}
                . Image changes apply immediately.
              </p>
            </div>
            <div className="min-w-0 space-y-4">
              <div className="grid min-w-0 gap-4 @2xl:grid-cols-[minmax(0,1fr)_minmax(140px,220px)_minmax(100px,160px)]">
                <FormField label="Name" error={fieldError("name")} required>
                  <Input
                    value={name}
                    onChange={(event) => setField("name", event.target.value)}
                  />
                </FormField>
                <FormField label="Category">
                  <AdminSelect
                    placeholder="Category"
                    value={category}
                    onChange={(value) => setField("category", value)}
                    options={[
                      { value: "", label: "None" },
                      ...CATEGORY_OPTIONS,
                    ]}
                    allowClear={false}
                    triggerClassName="w-full max-w-none"
                  />
                </FormField>
                <FormField
                  label="Featured rank"
                  error={fieldError("featuredRank")}
                >
                  <Input
                    inputMode="numeric"
                    value={featuredRank}
                    onChange={(event) =>
                      setField("featuredRank", event.target.value)
                    }
                    placeholder="Optional"
                  />
                </FormField>
              </div>
              <FormField label="Description">
                <Textarea
                  value={description}
                  onChange={(event) =>
                    setField("description", event.target.value)
                  }
                  rows={5}
                  placeholder="Editorial description shown in Listen"
                />
              </FormField>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-label="Playlist visibility"
                >
                  <TogglePill
                    label="Active"
                    active={isActive}
                    onClick={() => setField("isActive", (value) => !value)}
                  />
                  <TogglePill
                    label="Curated in Listen"
                    active={isCurated}
                    onClick={() => setField("isCurated", (value) => !value)}
                  />
                  {isSmart ? (
                    <TogglePill
                      label="Auto-refresh daily"
                      active={autoRefresh}
                      onClick={() => setField("autoRefresh", (value) => !value)}
                    />
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {describing ? (
                    <InfoBadge active data-ai-description-busy>
                      Generating
                    </InfoBadge>
                  ) : null}
                  <AIButton
                    actionId="playlists.description.generate"
                    type="button"
                    onClick={handleGenerateDescription}
                    loading={describing}
                    disabled={describing || !name.trim() || !llmAvailable}
                  >
                    Generate description with AI
                  </AIButton>
                </div>
              </div>
            </div>
          </div>
        </InstrumentPanel>

        {isSmart ? (
          <InstrumentPanel
            as="section"
            headingLevel={2}
            label={{ children: "Smart rules", tone: "accent" }}
            description="Choose which tracks match, how many to include and how to order them. Preview the selection before generating."
          >
            <div className="space-y-5">
              <div className="grid min-w-0 gap-4 @2xl:grid-cols-[minmax(140px,180px)_minmax(100px,120px)_minmax(140px,180px)]">
                <FormField label="Match" error={fieldError("match")}>
                  <AdminSelect
                    placeholder="Match"
                    value={match}
                    onChange={(value) =>
                      setField("match", value as "all" | "any")
                    }
                    options={[
                      { value: "all", label: "All rules" },
                      { value: "any", label: "Any rule" },
                    ]}
                    allowClear={false}
                    triggerClassName="w-full max-w-none"
                  />
                </FormField>
                <FormField
                  label="Limit"
                  hint="1–500 tracks"
                  error={fieldError("limit")}
                >
                  <Input
                    inputMode="numeric"
                    value={limit}
                    onChange={(event) => setField("limit", event.target.value)}
                  />
                </FormField>
                <FormField label="Sort" error={fieldError("sort")}>
                  <AdminSelect
                    placeholder="Sort"
                    value={sort}
                    onChange={(value) => setField("sort", value)}
                    options={SORT_OPTIONS}
                    allowClear={false}
                    triggerClassName="w-full max-w-none"
                  />
                </FormField>
              </div>
              <PlaylistTrackRequirements
                value={requireFullMixProfile}
                onChange={(value) => setField("requireFullMixProfile", value)}
                disabled={saving || generating}
              />
              <div className="space-y-5">
                {rules.map((rule, index) => {
                  const dropdownConfig = DROPDOWN_FIELDS[rule.field];
                  const dropdownOptions =
                    dropdownConfig && filterOptions
                      ? filterOptions[dropdownConfig.optionsKey].map(
                          (value) => ({ value, label: value }),
                        )
                      : [];
                  const numeric = getFieldType(rule.field) === "number";
                  return (
                    <fieldset
                      key={index}
                      className="min-w-0 space-y-3 border-0 border-b border-border-quiet p-0 pb-5"
                    >
                      <legend className="mb-3">
                        <MonoLabel as="span">Rule {index + 1}</MonoLabel>
                      </legend>
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                        <RuleExpression rule={rule} index={index} />
                        <ActionGroup label={`Rule ${index + 1} actions`}>
                          <ActionButton
                            label={`Remove rule ${index + 1}`}
                            tooltip="Remove rule"
                            onClick={() => removeRule(index)}
                          >
                            <Trash2
                              data-admin-ux="editor-remove-rule"
                              aria-hidden="true"
                            />
                          </ActionButton>
                        </ActionGroup>
                      </div>
                      <div className="grid min-w-0 gap-3 @2xl:grid-cols-[180px_160px_minmax(0,1fr)]">
                        <FormField
                          label="Field"
                          error={fieldError(`rules.${index}.field`)}
                        >
                          <AdminSelect
                            value={rule.field}
                            onChange={(value) => updateRuleField(index, value)}
                            options={RULE_FIELDS.map((field) => ({
                              value: field.value,
                              label: field.label,
                            }))}
                            allowClear={false}
                            placeholder="Field"
                            triggerClassName="w-full max-w-none"
                          />
                        </FormField>
                        <FormField
                          label="Operator"
                          error={fieldError(`rules.${index}.op`)}
                        >
                          <AdminSelect
                            value={rule.op}
                            onChange={(value) =>
                              updateRule(index, {
                                op: value,
                                value:
                                  value === "between" || value === "in"
                                    ? [""]
                                    : "",
                              })
                            }
                            options={getOpsForField(rule.field)}
                            allowClear={false}
                            placeholder="Operator"
                            triggerClassName="w-full max-w-none"
                          />
                        </FormField>
                        {rule.op === "between" ? (
                          <div className="grid min-w-0 grid-cols-2 gap-3">
                            {["Minimum", "Maximum"].map((label, valueIndex) => (
                              <FormField
                                key={label}
                                label={label}
                                error={
                                  fieldError(
                                    `rules.${index}.value.${valueIndex}`,
                                  ) ||
                                  (valueIndex === 0
                                    ? fieldError(`rules.${index}.value`)
                                    : undefined)
                                }
                              >
                                <Input
                                  inputMode={
                                    rule.field === "year"
                                      ? "numeric"
                                      : "decimal"
                                  }
                                  value={
                                    Array.isArray(rule.value)
                                      ? (rule.value[valueIndex] ?? "")
                                      : ""
                                  }
                                  onChange={(event) =>
                                    updateRule(index, {
                                      value: [0, 1].map((position) =>
                                        position === valueIndex
                                          ? event.target.value
                                          : Array.isArray(rule.value)
                                            ? (rule.value[position] ?? "")
                                            : "",
                                      ),
                                    })
                                  }
                                />
                              </FormField>
                            ))}
                          </div>
                        ) : rule.op === "in" ? (
                          <FormField
                            label="Values"
                            hint="Separate values with commas."
                            error={
                              fieldError(`rules.${index}.value`) ||
                              (validatedScope && !validation.valid
                                ? Object.entries(validation.errors).find(
                                    ([key]) =>
                                      key.startsWith(`rules.${index}.value.`),
                                  )?.[1]
                                : undefined)
                            }
                          >
                            <Input
                              value={
                                Array.isArray(rule.value)
                                  ? rule.value.join(",")
                                  : rule.value
                              }
                              onChange={(event) =>
                                updateRule(index, {
                                  value: event.target.value.split(","),
                                })
                              }
                            />
                          </FormField>
                        ) : dropdownConfig ? (
                          <FormField
                            label="Value"
                            error={fieldError(`rules.${index}.value`)}
                          >
                            <AdminSelect
                              value={String(rule.value ?? "")}
                              onChange={(value) => updateRule(index, { value })}
                              options={dropdownOptions}
                              placeholder={dropdownConfig.placeholder}
                              searchable
                              searchPlaceholder={
                                dropdownConfig.searchPlaceholder
                              }
                              allowClear={false}
                              triggerClassName="w-full max-w-none"
                            />
                          </FormField>
                        ) : (
                          <FormField
                            label="Value"
                            error={fieldError(`rules.${index}.value`)}
                          >
                            <Input
                              inputMode={
                                numeric
                                  ? rule.field === "year"
                                    ? "numeric"
                                    : "decimal"
                                  : "text"
                              }
                              value={String(rule.value ?? "")}
                              placeholder="Value"
                              onChange={(event) =>
                                updateRule(index, { value: event.target.value })
                              }
                            />
                          </FormField>
                        )}
                      </div>
                    </fieldset>
                  );
                })}
              </div>
              {fieldError("rules") ? (
                <p role="alert" className="text-sm text-state-warning-text">
                  {fieldError("rules")}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-text-muted">
                  Up to 12 rules. Generation saves the current rules; editorial
                  changes use Save changes.
                </p>
                <Button
                  variant="outline"
                  onClick={addRule}
                  disabled={rules.length >= 12}
                >
                  Add rule
                </Button>
              </div>
            </div>
          </InstrumentPanel>
        ) : null}

        {isSmart && (preview || previewing) ? (
          <InstrumentPanel
            as="section"
            headingLevel={2}
            label={{ children: "Preview", tone: "accent" }}
            status={
              previewing
                ? "Calculating"
                : previewStale
                  ? "Out of date"
                  : "Current rules"
            }
            actions={
              <Button
                variant="outline"
                onClick={handlePreview}
                disabled={previewing || saving || generating}
                loading={previewing}
              >
                {previewStale ? "Update preview" : "Recalculate preview"}
              </Button>
            }
          >
            {previewing ? (
              <LoadingState label="Calculating playlist preview" />
            ) : preview ? (
              <div className="space-y-5">
                {previewStale ? (
                  <p role="status" className="text-sm text-state-warning-text">
                    The rules changed after this preview. Update it before using
                    these results.
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-4">
                  <StatNumber
                    value={preview.total_matching.toLocaleString()}
                    label="Matching tracks"
                    size="lg"
                  />
                  <InfoBadge>
                    {formatMinutes(preview.duration_total_sec)}
                  </InfoBadge>
                  {preview.avg_year ? (
                    <InfoBadge>Avg year {preview.avg_year}</InfoBadge>
                  ) : null}
                  {preview.year_range ? (
                    <InfoBadge>
                      {preview.year_range[0]}–{preview.year_range[1]}
                    </InfoBadge>
                  ) : null}
                </div>
                <div className="grid min-w-0 gap-5 @2xl:grid-cols-2">
                  <DistributionBlock
                    label="Top genres"
                    items={Object.entries(preview.genre_distribution).slice(
                      0,
                      8,
                    )}
                  />
                  <DistributionBlock
                    label="Top artists"
                    items={Object.entries(preview.artist_distribution).slice(
                      0,
                      8,
                    )}
                  />
                </div>
                {preview.tracks.length ? (
                  <div className="space-y-3">
                    <MonoLabel as="h3">Matching track sample</MonoLabel>
                    <HairlineList label="Preview track sample">
                      {preview.tracks.slice(0, 8).map((track, index) => (
                        <HairlineRow
                          key={`${track.artist}-${track.album}-${track.title}-${index}`}
                          index={index + 1}
                          truncate={false}
                          trailing={
                            <MonoLabel
                              as="span"
                              meta={[
                                track.format,
                                track.year != null ? String(track.year) : null,
                                formatTrackDuration(track.duration),
                              ]}
                            />
                          }
                        >
                          <div className="text-sm text-text-primary">
                            {track.title || "Untitled"}
                          </div>
                          <p className="text-sm text-text-muted">
                            {[track.artist, track.album]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </HairlineRow>
                      ))}
                    </HairlineList>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="max-w-2xl text-sm text-text-muted">
                    Preview is a simulation. Generation reruns the current rules
                    and may select different tracks with random sorting.
                  </p>
                  <Button
                    variant="outline"
                    onClick={handleGenerate}
                    disabled={generating || saving || previewStale}
                    loading={generating}
                  >
                    Generate current rules
                  </Button>
                </div>
              </div>
            ) : null}
          </InstrumentPanel>
        ) : null}

        <InstrumentPanel
          as="section"
          headingLevel={2}
          label={{ children: "Tracks", tone: "accent" }}
          description={
            isSmart
              ? "Manual additions and reordered tracks are locked against future auto-refreshes."
              : "Add tracks from your library and arrange their order."
          }
          actions={
            <Button
              variant="outline"
              onClick={handleRefineTracklist}
              disabled={refining || (playlist.tracks?.length ?? 0) === 0}
              loading={refining}
            >
              {refining ? "Preparing refinements" : "Suggest refinements"}
            </Button>
          }
        >
          <div className="space-y-5">
            <div className="grid min-w-0 items-start gap-4 @2xl:grid-cols-[minmax(0,1fr)_220px]">
              <FormField label="Search tracks">
                <SearchInput
                  label="Search tracks"
                  value={trackSearchQuery}
                  onValueChange={setTrackSearchQuery}
                  placeholder={
                    isSmart && trackSearchScope === "rules"
                      ? "Search tracks matching this playlist…"
                      : "Search library tracks…"
                  }
                />
              </FormField>
              <FormField
                label="Search scope"
                hint={
                  isSmart && trackSearchScope === "rules"
                    ? "Uses saved rules. Preview evaluates pending rule changes."
                    : undefined
                }
              >
                <AdminSelect
                  placeholder="Search scope"
                  value={trackSearchScope}
                  onChange={(value) =>
                    setTrackSearchScope(value as "rules" | "library")
                  }
                  options={[
                    { value: "rules", label: "Matching rules" },
                    { value: "library", label: "Entire library" },
                  ]}
                  allowClear={false}
                  disabled={!isSmart}
                  triggerClassName="w-full max-w-none"
                />
              </FormField>
            </div>
            {trackSearching ? (
              <LoadingState label="Searching candidate tracks" />
            ) : trackSearchError ? (
              <ErrorState
                message={trackSearchError}
                onRetry={() => setSearchRetry((value) => value + 1)}
              />
            ) : trackSearchResults.length ? (
              <HairlineList label="Candidate tracks">
                {trackSearchResults.map((track, index) => {
                  const trackId = track.track_id ?? track.id ?? 0;
                  return (
                    <HairlineRow
                      key={`${trackId}-${index}`}
                      truncate={false}
                      trailing={
                        <Button
                          variant="outline"
                          disabled={addingTrackId !== null}
                          loading={addingTrackId === trackId}
                          aria-label={`Add ${track.title || "Untitled"} and lock`}
                          onClick={() => void handleAddCandidateTrack(track)}
                        >
                          Add locked
                        </Button>
                      }
                    >
                      <div className="text-sm text-text-primary">
                        {track.title || "Untitled"}
                      </div>
                      <p className="text-sm text-text-muted">
                        {[track.artist, track.album]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {track.duration != null ? (
                        <MonoLabel as="span">
                          {formatTrackDuration(track.duration)}
                        </MonoLabel>
                      ) : null}
                    </HairlineRow>
                  );
                })}
              </HairlineList>
            ) : deferredTrackSearchQuery.trim().length >= 2 ? (
              <EmptyState message="No candidate tracks found in this scope." />
            ) : null}

            {refineProposal ? (
              <InstrumentPanel
                as="section"
                headingLevel={3}
                label={{
                  children: "Editorial refinement proposal",
                  tone: "accent",
                }}
                description={refineProposal.summary}
                actions={
                  <>
                    <Button
                      variant="ghost"
                      onClick={() => setRefineProposal(null)}
                    >
                      Dismiss
                    </Button>
                    {refineProposal.actions.length ? (
                      <Button
                        variant="outline"
                        onClick={handleApplyRefinement}
                        disabled={applyingRefinement}
                        loading={applyingRefinement}
                      >
                        Apply safe fixes
                      </Button>
                    ) : null}
                  </>
                }
              >
                <div className="space-y-4">
                  {refineProposal.issues.length ? (
                    <HairlineList label="Refinement issues">
                      {refineProposal.issues.slice(0, 8).map((issue) => (
                        <HairlineRow
                          key={`${issue.type}-${issue.positions.join("-")}`}
                          truncate={false}
                        >
                          <div className="flex flex-wrap items-center gap-3">
                            <SeverityMeter
                              level={issue.severity}
                              label={issue.severity}
                            />
                            <span className="text-sm">{issue.message}</span>
                          </div>
                        </HairlineRow>
                      ))}
                    </HairlineList>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {refineProposal.actions.slice(0, 10).map((action) => (
                      <InfoBadge key={action.id}>{action.label}</InfoBadge>
                    ))}
                  </div>
                </div>
              </InstrumentPanel>
            ) : null}

            {playlist.tracks?.length ? (
              <PlaylistEditorTrackList
                tracks={playlist.tracks}
                onRemove={handleRemoveTrack}
                onReorder={handleTrackReorder}
                busy={
                  generating || applyingRefinement || addingTrackId !== null
                }
              />
            ) : (
              <EmptyState
                title="No tracks yet"
                description={
                  isSmart
                    ? "Generate the playlist when its rules are ready."
                    : "Search your library to add tracks."
                }
              />
            )}
          </div>
        </InstrumentPanel>

        {history.length ? (
          <InstrumentPanel
            as="section"
            headingLevel={2}
            label={{ children: "Generation history", tone: "accent" }}
          >
            <HairlineList label="Generation history">
              {history.map((entry) => (
                <HairlineRow
                  key={entry.id}
                  truncate={false}
                  trailing={
                    entry.track_count != null ? (
                      <MonoLabel as="span">
                        {entry.track_count} tracks
                      </MonoLabel>
                    ) : undefined
                  }
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <InfoBadge
                      tone={
                        entry.status === "failed"
                          ? "warning"
                          : entry.status === "completed"
                            ? "accent"
                            : "neutral"
                      }
                    >
                      {entry.status}
                    </InfoBadge>
                    <RelativeTime value={entry.started_at} />
                  </div>
                  <MonoLabel
                    as="p"
                    meta={[
                      entry.triggered_by,
                      entry.duration_sec != null
                        ? `${Math.round(entry.duration_sec)}s`
                        : null,
                    ]}
                  />
                  {entry.error ? (
                    <p className="text-sm text-state-warning-text">
                      {entry.error}
                    </p>
                  ) : null}
                </HairlineRow>
              ))}
            </HairlineList>
          </InstrumentPanel>
        ) : null}
      </div>
    </div>
  );
}
