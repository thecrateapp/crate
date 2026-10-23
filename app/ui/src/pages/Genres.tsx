import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { useState, useMemo, useCallback } from "react";
import {
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import { OpsPanel, OpsRefreshNotice } from "@/components/admin/ops-surfaces";
import {
  PageHeaderActions,
  PageHeaderLayout,
} from "@/components/layout/PageHeader";
import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ProgressHairline } from "@crate/ui/primitives/ProgressHairline";
import {
  Bot,
  Loader2,
  Settings,
  SlidersHorizontal,
  Tag,
} from "@crate/ui/icons";

import { Input } from "@crate/ui/shadcn/input";
import { Button } from "@crate/ui/shadcn/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@crate/ui/shadcn/dropdown-menu";
import { TooltipHint } from "@crate/ui/shadcn/tooltip";
import { GridSkeleton } from "@/components/ui/grid-skeleton";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { GenreTaxonomyExplorer } from "@/components/genres/GenreTaxonomyExplorer";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { useTaskPoll } from "@/hooks/use-task-poll";
import { useActionLLMStatus } from "@/hooks/use-llm";
import { ApiError, api } from "@/lib/api";
import { waitForTask } from "@/lib/tasks";
import { formatNumber } from "@/lib/utils";
import { Search, LayoutGrid, Network, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Genre {
  id: number;
  name: string;
  slug: string;
  artist_count: number;
  album_count: number;
  description?: string | null;
  external_description?: string | null;
  external_description_source?: string | null;
  musicbrainz_mbid?: string | null;
  wikidata_entity_id?: string | null;
  wikidata_url?: string | null;
  mapped?: boolean;
  canonical_slug?: string | null;
  canonical_name?: string | null;
  canonical_description?: string | null;
  top_level_slug?: string | null;
  top_level_name?: string | null;
  top_level_description?: string | null;
  cover_url?: string | null;
  eq_gains?: number[] | null;
  eq_reasoning?: string | null;
  eq_preset_resolved?: {
    gains: number[];
    source: "direct" | "inherited";
    slug: string;
    name: string;
  } | null;
}

interface InvalidTaxonomyNode {
  slug: string;
  name?: string | null;
  alias_count?: number;
  edge_count?: number;
  reason?: string | null;
}

interface InvalidTaxonomyStatus {
  invalid_count: number;
  alias_count: number;
  edge_count: number;
  items: InvalidTaxonomyNode[];
}

interface SoundIntelligenceHealth {
  eq: {
    total_genres: number;
    sources: { source: string; count: number; percent: number }[];
  };
  taxonomy: {
    node_count: number;
    top_level_count: number;
    orphan_count: number;
    missing_description_count: number;
    missing_direct_eq_count: number;
    unmapped_raw_count: number;
    edge_count: number;
    locked_edge_count: number;
    manual_edge_count: number;
    ai_edge_count: number;
    missing_effective_eq_count: number;
  };
  listening_priorities: {
    slug: string;
    name: string;
    weighted_play_count: number;
    listening_share_90d_pct: number;
  }[];
}

interface GenreDeleteResponse {
  ok: boolean;
  slug: string;
  name?: string | null;
  deleted_library_genres: number;
  deleted_taxonomy_nodes: number;
  removed_artist_assignments: number;
  removed_album_assignments: number;
  removed_raw_genres: string[];
}

interface TaxonomyProposal {
  ok: boolean;
  slug: string;
  name?: string | null;
  source_kind: "raw_genre" | "taxonomy_node";
  recommended_action:
    | "create_node"
    | "alias_existing"
    | "delete_marginal"
    | "classify_facet"
    | "needs_review";
  recommended_target_slug?: string | null;
  description: string;
  aliases: string[];
  relations: {
    relation_type: string;
    target_slugs: string[];
    confidence: number;
    reasoning: string;
  }[];
  facets: { dimension: string; slug: string; name: string }[];
  reasoning: string;
}

interface UnmappedGenreProposal {
  genre: Genre;
  proposal: TaxonomyProposal;
}

type UnmappedGenreAction = "facet" | "enrich";

const TAXONOMY_ACTION_LABELS: Record<
  TaxonomyProposal["recommended_action"],
  string
> = {
  create_node: "Create taxonomy genre",
  alias_existing: "Map to an existing genre",
  delete_marginal: "Map to an existing genre",
  classify_facet: "Classify as a facet",
  needs_review: "Needs curator review",
};

function UnmappedGenreActions({
  genre,
  busyAction,
  canDelete,
  canEnrich,
  onAction,
  onDelete,
}: {
  genre: Genre;
  busyAction: UnmappedGenreAction | null;
  canDelete: boolean;
  canEnrich: boolean;
  onAction: (genre: Genre, action: UnmappedGenreAction) => void;
  onDelete: (genre: Genre) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {canDelete ? (
        <>
          <ActionIconButton
            variant="row"
            title={`Mark ${genre.name} as facet`}
            disabled={busyAction !== null}
            onClick={() => onAction(genre, "facet")}
          >
            {busyAction === "facet" ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Tag aria-hidden="true" />
            )}
          </ActionIconButton>
          {canEnrich ? (
            <ActionIconButton
              variant="row"
              tone="primary"
              title={`Enrich ${genre.name} with AI`}
              disabled={busyAction !== null}
              onClick={() => onAction(genre, "enrich")}
            >
              {busyAction === "enrich" ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Bot aria-hidden="true" />
              )}
            </ActionIconButton>
          ) : null}
          <ActionIconButton
            variant="row"
            tone="danger"
            title={`Delete ${genre.name}`}
            disabled={busyAction !== null}
            onClick={() => onDelete(genre)}
          >
            <Trash2 aria-hidden="true" />
          </ActionIconButton>
        </>
      ) : null}
    </div>
  );
}

const EQ_SOURCE_LABELS: Record<string, string> = {
  genre_taxonomy_preset: "Direct genre EQ",
  genre_taxonomy_inherited_preset: "Inherited genre EQ",
  no_genre_eq: "No genre preset",
};

function genreDeleteSummary(result: GenreDeleteResponse) {
  const assignmentCount =
    result.removed_artist_assignments + result.removed_album_assignments;
  if (assignmentCount === 0) return "Deleted genre metadata";
  return `Removed ${assignmentCount} genre assignment${
    assignmentCount === 1 ? "" : "s"
  }`;
}

// ── Task action helper ─────────────────────────────────────────

function useGenreTask(
  pollTask: ReturnType<typeof useTaskPoll>["pollTask"],
  afterSuccess?: () => void,
) {
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const run = useCallback(
    async (
      key: string,
      url: string,
      body: Record<string, unknown>,
      opts: {
        successMessage: (result: Record<string, unknown>) => string;
        errorMessage: string;
        pollInterval?: number;
        pollTimeout?: number;
      },
    ) => {
      if (busy[key]) return;
      setBusy((prev) => ({ ...prev, [key]: true }));
      try {
        const { task_id } = await api<{ task_id: string }>(url, "POST", body);
        pollTask(
          task_id,
          (result) => {
            setBusy((prev) => ({ ...prev, [key]: false }));
            afterSuccess?.();
            toast.success(opts.successMessage(result || {}));
          },
          (error) => {
            setBusy((prev) => ({ ...prev, [key]: false }));
            toast.error(error || opts.errorMessage);
          },
          opts.pollInterval ?? 3000,
          opts.pollTimeout ?? 30 * 60 * 1000,
        );
      } catch {
        setBusy((prev) => ({ ...prev, [key]: false }));
        toast.error(opts.errorMessage);
      }
    },
    [busy, pollTask, afterSuccess],
  );

  const isBusy = useCallback((key: string) => !!busy[key], [busy]);
  return { run, isBusy };
}

// ── Genre List ──────────────────────────────────────────────────

const GENRE_LIST_DESCRIPTION =
  "Taxonomy curation, raw tag cleanup and discovery of the graph that organizes the musical vocabulary of the library.";

export function Genres() {
  const { slug } = useParams<{ slug?: string }>();

  if (slug) {
    return (
      <Navigate to={`/genres?genre=${encodeURIComponent(slug)}`} replace />
    );
  }
  return <GenreList />;
}

function GenreList() {
  const { hasCapability } = useAuth();
  const canCurateGenres = hasCapability("curation.genres.write");
  const canCuratePlaylists = hasCapability("curation.playlists.write");
  const taxonomyProposalLLM = useActionLLMStatus("genres.taxonomy.propose");
  const {
    data: genres,
    loading,
    error,
    refetch,
  } = useApi<Genre[]>("/api/genres");
  const { data: unmappedGenres, refetch: refetchUnmapped } = useApi<Genre[]>(
    "/api/genres/unmapped?limit=100",
  );
  const { data: invalidTaxonomy, refetch: refetchInvalidTaxonomy } =
    useApi<InvalidTaxonomyStatus>(
      canCurateGenres ? "/api/genres/taxonomy/invalid?limit=8" : null,
    );
  const { data: soundHealth, refetch: refetchSoundHealth } =
    useApi<SoundIntelligenceHealth>(
      canCurateGenres ? "/api/genres/sound-intelligence/health" : null,
    );
  const { pollTask } = useTaskPoll();
  const [filter, setFilter] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "explorer">("explorer");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [taxonomyMaintenanceOpen, setTaxonomyMaintenanceOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Genre | null>(null);
  const [unmappedActionBusy, setUnmappedActionBusy] = useState<
    Record<string, UnmappedGenreAction>
  >({});
  const [unmappedProposal, setUnmappedProposal] =
    useState<UnmappedGenreProposal | null>(null);
  const [wheelUnavailable, setWheelUnavailable] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedGenreSlug = searchParams.get("genre");

  const selectGenre = useCallback(
    (slug: string | null) => {
      setViewMode("explorer");
      const nextSearchParams = new URLSearchParams(searchParams);
      if (slug) nextSearchParams.set("genre", slug);
      else nextSearchParams.delete("genre");
      navigate({ pathname: "/genres", search: nextSearchParams.toString() });
    },
    [navigate, searchParams],
  );

  const handleWheelUnavailable = useCallback(() => {
    setWheelUnavailable(true);
    setViewMode("grid");
  }, []);

  const afterSuccess = useCallback(() => {
    refetch();
    refetchUnmapped();
    if (canCurateGenres) refetchInvalidTaxonomy();
    if (canCurateGenres) refetchSoundHealth();
  }, [
    canCurateGenres,
    refetch,
    refetchUnmapped,
    refetchInvalidTaxonomy,
    refetchSoundHealth,
  ]);

  async function handleUnmappedAction(
    genre: Genre,
    action: UnmappedGenreAction,
  ) {
    setUnmappedActionBusy((current) => ({ ...current, [genre.slug]: action }));
    try {
      if (action === "facet") {
        await api(
          `/api/genres/taxonomy/raw-tags/${encodeURIComponent(genre.slug)}/classification`,
          "PUT",
          { classification: "facet", facets: [] },
        );
        toast.success(`${genre.name} marked as a facet`);
        afterSuccess();
        return;
      }

      const proposal = await api<TaxonomyProposal>(
        `/api/genres/taxonomy/${encodeURIComponent(genre.slug)}/proposal`,
        "POST",
      );
      setUnmappedProposal({ genre, proposal });
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : action === "facet"
            ? `Failed to mark ${genre.name} as a facet`
            : `Failed to enrich ${genre.name} with AI`,
      );
    } finally {
      setUnmappedActionBusy((current) => {
        const next = { ...current };
        delete next[genre.slug];
        return next;
      });
    }
  }

  async function applyUnmappedProposal() {
    if (!unmappedProposal) return;
    const { genre, proposal } = unmappedProposal;
    await api(
      `/api/genres/taxonomy/${encodeURIComponent(genre.slug)}/proposal/apply`,
      "POST",
      {
        source_kind: "raw_genre",
        recommended_action: proposal.recommended_action,
        recommended_target_slug: proposal.recommended_target_slug,
        name: proposal.name,
        description: proposal.description,
        aliases: proposal.aliases,
        relations: proposal.relations,
        facets: proposal.facets.map(({ dimension, name }) => ({
          dimension,
          name,
        })),
        reasoning: proposal.reasoning,
      },
    );
    toast.success(
      proposal.recommended_action === "classify_facet"
        ? `${genre.name} classified as a facet`
        : `${genre.name} taxonomy proposal applied`,
    );
    afterSuccess();
    setUnmappedProposal(null);
  }

  const { run, isBusy } = useGenreTask(pollTask, afterSuccess);

  const filtered = useMemo(() => {
    if (!genres) return [];
    return genres
      .filter(
        (g) =>
          g.name.toLowerCase().includes(filter.toLowerCase()) &&
          (!hideEmpty || g.artist_count > 0 || g.album_count > 0),
      )
      .sort((a, b) => b.artist_count - a.artist_count);
  }, [genres, filter, hideEmpty]);

  const filteredUnmapped = useMemo(
    () =>
      (unmappedGenres ?? [])
        .filter(
          (genre) =>
            genre.name.toLowerCase().includes(filter.toLowerCase()) &&
            (!hideEmpty || genre.artist_count > 0 || genre.album_count > 0),
        )
        .slice(0, 12),
    [unmappedGenres, filter, hideEmpty],
  );

  const mappedCount = useMemo(
    () => (genres ?? []).filter((genre) => genre.mapped).length,
    [genres],
  );

  async function reindex() {
    setIndexing(true);
    try {
      const { task_id } = await api<{ task_id: string }>(
        "/api/genres/index",
        "POST",
      );
      const task = await waitForTask(task_id, 30 * 60 * 1000);
      if (task.status === "completed") {
        afterSuccess();
        toast.success("Genres re-indexed");
      } else {
        toast.error(task.error || "Genre indexing failed");
      }
    } catch {
      toast.error("Failed to start indexing");
    } finally {
      setIndexing(false);
    }
  }

  async function deleteRawGenre() {
    if (!deleteTarget) return;
    try {
      const result = await api<GenreDeleteResponse>(
        `/api/genres/${encodeURIComponent(deleteTarget.slug)}`,
        "DELETE",
      );
      toast.success(genreDeleteSummary(result));
      setDeleteTarget(null);
      afterSuccess();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? `Failed to delete genre: ${error.message}`
          : "Failed to delete genre",
      );
    }
  }

  const pageHeader = (
    <PageHeaderLayout
      as="header"
      actions={
        <PageHeaderActions label="Genre taxonomy controls">
          <ActionIconButton
            variant="row"
            active={hideEmpty}
            aria-pressed={hideEmpty}
            aria-label={hideEmpty ? "Show empty genres" : "Hide empty genres"}
            title={hideEmpty ? "Show empty genres" : "Hide empty genres"}
            onClick={() => setHideEmpty(!hideEmpty)}
          >
            <SlidersHorizontal aria-hidden="true" />
          </ActionIconButton>
          <div
            role="group"
            aria-label="Genre taxonomy views"
            className="flex items-center gap-1"
          >
            <ActionIconButton
              variant="row"
              active={viewMode === "grid"}
              aria-pressed={viewMode === "grid"}
              onClick={() => setViewMode("grid")}
              title="Grid view"
            >
              <LayoutGrid size={14} />
            </ActionIconButton>
            <ActionIconButton
              variant="row"
              active={viewMode === "explorer"}
              aria-pressed={viewMode === "explorer"}
              onClick={() => setViewMode("explorer")}
              title="Taxonomy explorer"
            >
              <Network size={14} />
            </ActionIconButton>
          </div>
          {canCurateGenres ? (
            <DropdownMenu
              open={taxonomyMaintenanceOpen}
              onOpenChange={setTaxonomyMaintenanceOpen}
            >
              <TooltipHint content="Taxonomy maintenance">
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    className="shrink-0 rounded-full p-0"
                    aria-label="Taxonomy maintenance"
                  >
                    <Settings aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipHint>
              <DropdownMenuContent align="end" sideOffset={8} className="w-72">
                <DropdownMenuLabel>
                  <MonoLabel as="span">External sources</MonoLabel>
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    disabled={isBusy("mb-sync")}
                    onSelect={() =>
                      void run(
                        "mb-sync",
                        "/api/genres/musicbrainz/sync",
                        { limit: 80 },
                        {
                          successMessage: (r) =>
                            `MusicBrainz sync: ${r.edges_synced ?? 0} edges, ${r.matched_musicbrainz ?? 0} matched`,
                          errorMessage: "MusicBrainz sync failed",
                          pollTimeout: 60 * 60 * 1000,
                        },
                      )
                    }
                  >
                    <MonoLabel as="span">
                      {isBusy("mb-sync")
                        ? "Syncing MusicBrainz…"
                        : "Sync MusicBrainz"}
                    </MonoLabel>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={isBusy("enrich")}
                    onSelect={() =>
                      void run(
                        "enrich",
                        "/api/genres/descriptions/enrich",
                        { limit: 160 },
                        {
                          successMessage: (r) =>
                            `Enrichment: ${r.updated ?? 0} updated, ${r.remaining_without_external ?? 0} missing`,
                          errorMessage: "Description enrichment failed",
                          pollTimeout: 45 * 60 * 1000,
                        },
                      )
                    }
                  >
                    <MonoLabel as="span">
                      {isBusy("enrich")
                        ? "Enriching descriptions…"
                        : "Enrich descriptions"}
                    </MonoLabel>
                  </DropdownMenuItem>
                </DropdownMenuGroup>

                <DropdownMenuSeparator />
                <DropdownMenuLabel>
                  <MonoLabel as="span">Taxonomy curation</MonoLabel>
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    disabled={isBusy("infer")}
                    onSelect={() =>
                      void run(
                        "infer",
                        "/api/genres/infer",
                        {
                          limit: 250,
                          aggressive: true,
                          include_external: true,
                        },
                        {
                          successMessage: (r) =>
                            `Inference: ${r.mapped ?? 0} mapped, ${r.remaining_unmapped ?? 0} unmapped`,
                          errorMessage: "Taxonomy inference failed",
                        },
                      )
                    }
                  >
                    <MonoLabel as="span">
                      {isBusy("infer")
                        ? "Inferring taxonomy…"
                        : "Infer taxonomy"}
                    </MonoLabel>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={isBusy("rebuild-proposal")}
                    onSelect={() =>
                      void run(
                        "rebuild-proposal",
                        "/api/genres/taxonomy/rebuild-proposal",
                        {
                          alias_limit: 120,
                          node_limit: 16,
                          aggressive: true,
                          include_external: true,
                        },
                        {
                          successMessage: (r) => {
                            const summary =
                              (r.summary as
                                Record<string, unknown> | undefined) || {};
                            return `Proposal: ${summary.alias_proposals ?? 0} aliases, ${summary.node_proposals ?? 0} nodes`;
                          },
                          errorMessage: "Taxonomy rebuild proposal failed",
                          pollTimeout: 60 * 60 * 1000,
                        },
                      )
                    }
                  >
                    <MonoLabel as="span">
                      {isBusy("rebuild-proposal")
                        ? "Building AI proposal…"
                        : "Build proposal with AI"}
                    </MonoLabel>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={isBusy("cleanup-invalid")}
                    onSelect={() =>
                      void run(
                        "cleanup-invalid",
                        "/api/genres/taxonomy/cleanup-invalid",
                        {},
                        {
                          successMessage: (r) =>
                            `Cleanup: ${r.deleted_count ?? 0} invalid nodes removed`,
                          errorMessage: "Genre taxonomy cleanup failed",
                        },
                      )
                    }
                  >
                    <MonoLabel as="span">
                      {isBusy("cleanup-invalid")
                        ? "Cleaning invalid nodes…"
                        : "Clean invalid nodes"}
                    </MonoLabel>
                  </DropdownMenuItem>
                </DropdownMenuGroup>

                <DropdownMenuSeparator />
                <DropdownMenuLabel>
                  <MonoLabel as="span">Index</MonoLabel>
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    disabled={indexing}
                    onSelect={() => void reindex()}
                  >
                    <MonoLabel as="span">
                      {indexing ? "Re-indexing genres…" : "Re-index genres"}
                    </MonoLabel>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </PageHeaderActions>
      }
    >
      <div>
        <h1 className="m-0 font-display text-[clamp(2.25rem,4vw,3.75rem)] font-extrabold leading-display tracking-[-0.045em] text-balance text-text-primary">
          Genres
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-text-muted">
          {GENRE_LIST_DESCRIPTION}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {genres ? (
            <>
              <InfoBadge>{formatNumber(genres.length)} library tags</InfoBadge>
              <InfoBadge tone="accent">
                {formatNumber(mappedCount)} mapped
              </InfoBadge>
            </>
          ) : (
            <InfoBadge>Loading genre catalog</InfoBadge>
          )}
          {canCurateGenres && invalidTaxonomy ? (
            <InfoBadge
              tone={invalidTaxonomy.invalid_count > 0 ? "warning" : "success"}
            >
              {invalidTaxonomy.invalid_count > 0
                ? `${formatNumber(invalidTaxonomy.invalid_count)} invalid nodes`
                : "Taxonomy clean"}
            </InfoBadge>
          ) : null}
        </div>
      </div>
    </PageHeaderLayout>
  );

  if (error && !genres) {
    return (
      <main className="min-w-0 space-y-8">
        {pageHeader}
        <OpsRefreshNotice
          message="Could not load the genre catalog. Try again."
          onRetry={refetch}
        />
      </main>
    );
  }
  if (loading && !genres) {
    return (
      <main className="min-w-0 space-y-8">
        {pageHeader}
        <GridSkeleton count={12} columns="grid-cols-4" />
      </main>
    );
  }

  return (
    <main className="min-w-0 space-y-8 pb-6">
      {pageHeader}

      {canCurateGenres && soundHealth ? (
        <InstrumentPanel
          as="section"
          headingLevel={2}
          summary="Genre EQ coverage and taxonomy health"
          label={{
            children: "Sound intelligence",
            tone: "accent",
          }}
          description="Listening-led EQ priorities and effective preset coverage across the taxonomy."
          meta={`${formatNumber(soundHealth.eq.total_genres)} taxonomy nodes`}
        >
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <section aria-label="Listening-led genre EQ priorities" className="min-w-0">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <MonoLabel as="h3" tone="accent" size="eyebrow">
                  Most listened without genre EQ
                </MonoLabel>
                <MonoLabel as="span" size="label">
                  Last 90 days
                </MonoLabel>
              </div>
              <p className="mb-3 mt-0 text-xs text-text-muted">
                No direct preset or preset inherited from a parent. Multi-genre
                listening is split evenly across its tags.
              </p>
              {soundHealth.listening_priorities.length ? (
                <div className="space-y-1">
                  {soundHealth.listening_priorities.map((priority) => (
                    <button
                      key={priority.slug}
                      type="button"
                      onClick={() => selectGenre(priority.slug)}
                      aria-label={`Review ${priority.name} genre`}
                      className="group w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-[var(--hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-action"
                    >
                      <span className="mb-1.5 flex items-baseline justify-between gap-4">
                        <MonoLabel
                          as="span"
                          size="label"
                          className="transition-colors group-hover:text-accent-action-hi"
                        >
                          {priority.name}
                        </MonoLabel>
                        <span className="shrink-0 text-xs tabular-nums text-text-muted transition-colors group-hover:text-accent-action-hi">
                          {priority.weighted_play_count.toFixed(1)} weighted plays
                          <span className="ml-2 text-text-subtle">
                            {priority.listening_share_90d_pct}%
                          </span>
                        </span>
                      </span>
                      <ProgressHairline
                        label={`${priority.name} share of 90-day listening`}
                        value={priority.listening_share_90d_pct / 100}
                        valueText={`${priority.listening_share_90d_pct}%`}
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="m-0 rounded-md bg-surface-subtle px-3 py-3 text-sm text-text-muted">
                  No 90-day listening is recorded for genres without an
                  effective EQ preset.
                </p>
              )}
            </section>
            <section aria-label="Effective EQ source coverage" className="min-w-0">
              <MonoLabel as="h3" tone="accent" size="eyebrow" className="mb-3">
                Genre EQ coverage
              </MonoLabel>
              <div className="space-y-1">
                {soundHealth.eq.sources
                  .filter((source) => source.count > 0)
                  .map((source) => (
                    <div
                      key={source.source}
                      className="group -mx-2 grid gap-1 rounded-md px-2 py-2 transition-colors hover:bg-[var(--hover-bg)]"
                    >
                      <div className="flex items-baseline justify-between gap-4">
                        <MonoLabel
                          as="span"
                          size="label"
                          className="transition-colors group-hover:text-accent-action-hi"
                        >
                          {EQ_SOURCE_LABELS[source.source] ?? source.source}
                        </MonoLabel>
                        <MonoLabel
                          as="span"
                          size="label"
                          className="shrink-0 tabular-nums transition-colors group-hover:text-accent-action-hi"
                        >
                          {formatNumber(source.count)} · {source.percent}%
                        </MonoLabel>
                      </div>
                      <ProgressHairline
                        label={`${EQ_SOURCE_LABELS[source.source] ?? source.source} EQ coverage`}
                        value={source.percent / 100}
                        valueText={`${source.percent}%`}
                      />
                    </div>
                  ))}
              </div>
            </section>
            <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-border-quiet pt-5 sm:grid-cols-4 xl:col-span-2">
              <div className="min-w-0">
                <MonoLabel as="dt" size="eyebrow">
                  Needs mapping
                </MonoLabel>
                <dd
                  className={`m-0 mt-2 font-display text-2xl font-semibold tabular-nums ${soundHealth.taxonomy.unmapped_raw_count > 0 ? "text-state-warning-text" : "text-text-primary"}`}
                >
                  {formatNumber(soundHealth.taxonomy.unmapped_raw_count)}
                </dd>
                <p className="m-0 mt-1 text-xs text-text-muted">
                  Raw library tags outside the graph
                </p>
              </div>
              <div className="min-w-0">
                <MonoLabel as="dt" size="eyebrow">
                  Orphan nodes
                </MonoLabel>
                <dd
                  className={`m-0 mt-2 font-display text-2xl font-semibold tabular-nums ${soundHealth.taxonomy.orphan_count > 0 ? "text-state-warning-text" : "text-text-primary"}`}
                >
                  {formatNumber(soundHealth.taxonomy.orphan_count)}
                </dd>
                <p className="m-0 mt-1 text-xs text-text-muted">
                  Nodes without a parent relation
                </p>
              </div>
              <div className="min-w-0">
                <MonoLabel as="dt" size="eyebrow">
                  No genre EQ
                </MonoLabel>
                <dd
                  className={`m-0 mt-2 font-display text-2xl font-semibold tabular-nums ${soundHealth.taxonomy.missing_effective_eq_count > 0 ? "text-state-warning-text" : "text-text-primary"}`}
                >
                  {formatNumber(soundHealth.taxonomy.missing_effective_eq_count)}
                </dd>
                <p className="m-0 mt-1 text-xs text-text-muted">
                  Nodes without a direct or inherited preset
                </p>
              </div>
              <div className="min-w-0">
                <MonoLabel as="dt" size="eyebrow">
                  Missing copy
                </MonoLabel>
                <dd
                  className={`m-0 mt-2 font-display text-2xl font-semibold tabular-nums ${soundHealth.taxonomy.missing_description_count > 0 ? "text-state-warning-text" : "text-text-primary"}`}
                >
                  {formatNumber(soundHealth.taxonomy.missing_description_count)}
                </dd>
                <p className="m-0 mt-1 text-xs text-text-muted">
                  Nodes without an editorial description
                </p>
              </div>
            </dl>
          </div>
        </InstrumentPanel>
      ) : null}

      {error ? (
        <OpsRefreshNotice
          message="Could not refresh the genre catalog. Showing the last successful results."
          onRetry={refetch}
        />
      ) : null}

      <OpsPanel
        title="Genre taxonomy"
        titleTone="accent"
        description="Navigate the curated graph or inspect the library’s raw genre tags."
      >
        <div className="flex flex-col gap-4">
          <div className="min-w-0">
            <div className="relative w-full min-w-0">
              <Search
                size={16}
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle"
              />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter genres..."
                className="pl-9"
              />
            </div>
          </div>

          {wheelUnavailable ? (
            <div
              className="flex flex-wrap items-center gap-2 text-sm text-text-muted"
              role="status"
            >
              <InfoBadge tone="warning">Wheel unavailable</InfoBadge>
              <span>
                Showing the tag grid until core taxonomy data is available.
              </span>
            </div>
          ) : null}

          {canCurateGenres && !!invalidTaxonomy?.invalid_count && (
            <div className="space-y-4 border-l-2 border-state-warning/60 pl-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full bg-state-warning-text"
                />
                <MonoLabel as="h3" tone="accent" size="eyebrow">
                  Taxonomy cleanup recommended
                </MonoLabel>
                <InfoBadge tone="warning">
                  {invalidTaxonomy.invalid_count} invalid nodes
                </InfoBadge>
                <InfoBadge tone="warning">
                  {invalidTaxonomy.alias_count} aliases
                </InfoBadge>
                <InfoBadge tone="warning">
                  {invalidTaxonomy.edge_count} edges
                </InfoBadge>
              </div>
              <p className="m-0 text-sm text-text-muted">
                MusicBrainz syncs previously stored malformed taxonomy nodes.
                You can remove them safely with the cleanup task.
              </p>
              <div className="grid grid-cols-1 gap-x-5 md:grid-cols-2 xl:grid-cols-4">
                {invalidTaxonomy.items.map((item) => (
                  <div
                    key={`invalid-taxonomy-${item.slug}`}
                    className="min-w-0 border-b border-border-quiet py-2"
                  >
                    <div className="truncate text-sm font-medium text-text-primary">
                      {item.name || item.slug}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-text-muted">
                      {item.reason?.replace(/-/g, " ") || "invalid node"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {viewMode === "explorer" ? (
            <GenreTaxonomyExplorer
              filter={filter}
              hideEmpty={hideEmpty}
              canCurate={canCurateGenres}
              canCreatePlaylists={canCuratePlaylists}
              onChanged={afterSuccess}
              onUnsupported={handleWheelUnavailable}
              selectedSlug={selectedGenreSlug}
              onSelectGenre={selectGenre}
            />
          ) : (
            <>
              {(unmappedGenres?.length || 0) > 0 && (
                <div className="space-y-3 border-l-2 border-state-warning/60 pl-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <MonoLabel as="h3" tone="accent" size="eyebrow">
                      Needs taxonomy mapping
                    </MonoLabel>
                    <InfoBadge tone="warning">
                      {filteredUnmapped.length} shown
                    </InfoBadge>
                  </div>
                  <p className="m-0 text-sm text-text-muted">
                    Genres from tags or MusicBrainz that still sit outside the
                    curated graph. This list shows up to 100 tags; run inference
                    to map them.
                  </p>
                  {filteredUnmapped.length > 0 ? (
                    <div className="grid grid-cols-1 gap-x-5 md:grid-cols-2 xl:grid-cols-3">
                      {filteredUnmapped.map((genre) => (
                        <div
                          key={`unmapped-${genre.slug}`}
                          className="flex min-w-0 items-center justify-between gap-3 border-b border-border-quiet py-2 text-left"
                        >
                          <div className="min-w-0 flex-1 text-left">
                            <div className="truncate text-sm font-medium text-text-primary">
                              {genre.name}
                            </div>
                            <MonoLabel as="div" className="mt-1">
                              {formatNumber(genre.artist_count)} artists ·{" "}
                              {formatNumber(genre.album_count)} albums
                            </MonoLabel>
                          </div>
                          <UnmappedGenreActions
                            genre={genre}
                            busyAction={unmappedActionBusy[genre.slug] ?? null}
                            canDelete={canCurateGenres}
                            canEnrich={taxonomyProposalLLM?.available === true}
                            onAction={handleUnmappedAction}
                            onDelete={setDeleteTarget}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="m-0 text-sm text-text-muted" role="status">
                      No unmapped genres match this filter.
                    </p>
                  )}
                </div>
              )}

              {filtered.length === 0 ? (
                <div className="border-y border-border-quiet px-5 py-10 text-center">
                  <h3 className="m-0 font-display text-lg font-semibold text-text-primary">
                    {genres?.length === 0
                      ? "No genres indexed yet"
                      : "No genres match this search"}
                  </h3>
                  <p className="mx-auto mb-0 mt-2 max-w-md text-sm text-text-muted">
                    {genres?.length === 0
                      ? "Index the library to build its genre catalog and taxonomy."
                      : "Try a broader name or clear the search to see the full catalog."}
                  </p>
                  {genres?.length === 0 && canCurateGenres ? (
                    <Button
                      className="mt-4"
                      onClick={reindex}
                      disabled={indexing}
                    >
                      {indexing ? "Indexing…" : "Index Genres"}
                    </Button>
                  ) : filter ? (
                    <Button
                      className="mt-4"
                      variant="outline"
                      onClick={() => setFilter("")}
                    >
                      Clear search
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-x-5 md:grid-cols-2 xl:grid-cols-3">
                  {filtered.map((g) => (
                    <div
                      key={g.id}
                      className={`group min-w-0 border-b border-border-quiet py-3 text-left ${g.mapped ? "" : "border-l-2 border-l-state-warning/60 pl-3"}`}
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        {g.mapped ? (
                          <button
                            type="button"
                            onClick={() =>
                              selectGenre(g.canonical_slug ?? g.slug)
                            }
                            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left"
                          >
                            <div className="truncate text-sm font-semibold text-text-primary group-hover:text-accent-action-hi">
                              {g.name}
                            </div>
                          </button>
                        ) : (
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
                            {g.name}
                          </span>
                        )}
                        <div className="flex shrink-0 items-center gap-1">
                          <InfoBadge tone={g.mapped ? "accent" : "warning"}>
                            {g.mapped ? "mapped" : "unmapped"}
                          </InfoBadge>
                          {g.mapped && canCurateGenres ? (
                            <ActionIconButton
                              variant="row"
                              tone="danger"
                              title={`Delete ${g.name}`}
                              onClick={() => setDeleteTarget(g)}
                            >
                              <Trash2 aria-hidden="true" />
                            </ActionIconButton>
                          ) : null}
                          {!g.mapped ? (
                            <UnmappedGenreActions
                              genre={g}
                              busyAction={unmappedActionBusy[g.slug] ?? null}
                              canDelete={canCurateGenres}
                              canEnrich={taxonomyProposalLLM?.available === true}
                              onAction={handleUnmappedAction}
                              onDelete={setDeleteTarget}
                            />
                          ) : null}
                        </div>
                      </div>
                      {g.canonical_name && g.canonical_name !== g.name && (
                        <div className="mb-1 truncate text-sm text-text-secondary">
                          <MonoLabel as="span" className="mr-1">
                            Canonical
                          </MonoLabel>
                          {g.canonical_name}
                        </div>
                      )}
                      {g.top_level_name && (
                        <div className="mb-1 truncate text-sm text-text-secondary">
                          <MonoLabel as="span" className="mr-1">
                            Family
                          </MonoLabel>
                          {g.top_level_name}
                        </div>
                      )}
                      <MonoLabel as="div" className="mt-2">
                        {formatNumber(g.artist_count)} artists ·{" "}
                        {formatNumber(g.album_count)} albums
                      </MonoLabel>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </OpsPanel>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete ${deleteTarget?.name ?? "genre"}?`}
        description="This removes this raw genre from every artist and album that currently uses it. This cannot be undone."
        confirmLabel="Delete Genre"
        variant="destructive"
        onConfirm={() => {
          void deleteRawGenre();
        }}
        eyebrow="Confirm action"
        consequence={`${
          deleteTarget?.name ?? "Genre"
        } · removes raw genre assignments from artists and albums`}
      />

      <ConfirmDialog
        open={unmappedProposal !== null}
        onOpenChange={(open) => {
          if (!open) setUnmappedProposal(null);
        }}
        title={`AI proposal · ${unmappedProposal?.genre.name ?? "genre"}`}
        description="Review how AI classified this unmapped tag before applying any taxonomy changes."
        eyebrow="Genre enrichment"
        size="md"
        body={
          unmappedProposal ? (
            <div className="space-y-4 text-sm text-text-secondary">
              <div>
                <MonoLabel as="div" tone="accent" size="eyebrow">
                  Recommended action
                </MonoLabel>
                <p className="mb-0 mt-1 font-medium text-text-primary">
                  {TAXONOMY_ACTION_LABELS[
                    unmappedProposal.proposal.recommended_action
                  ]}
                </p>
              </div>
              {unmappedProposal.proposal.recommended_target_slug ? (
                <div>
                  <MonoLabel as="div" size="label">
                    Suggested genre
                  </MonoLabel>
                  <p className="mb-0 mt-1">
                    {unmappedProposal.proposal.recommended_target_slug}
                  </p>
                </div>
              ) : null}
              {unmappedProposal.proposal.description ? (
                <div>
                  <MonoLabel as="div" size="label">
                    Description
                  </MonoLabel>
                  <p className="mb-0 mt-1">
                    {unmappedProposal.proposal.description}
                  </p>
                </div>
              ) : null}
              {unmappedProposal.proposal.facets.length > 0 ? (
                <div>
                  <MonoLabel as="div" size="label">
                    Facet suggestions
                  </MonoLabel>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {unmappedProposal.proposal.facets.map((facet) => (
                      <InfoBadge
                        key={`${facet.dimension}:${facet.slug}`}
                        title={`${facet.dimension}: ${facet.name}`}
                      >
                        {facet.dimension} · {facet.name}
                      </InfoBadge>
                    ))}
                  </div>
                </div>
              ) : null}
              {unmappedProposal.proposal.aliases.length > 0 ? (
                <div>
                  <MonoLabel as="div" size="label">
                    Aliases
                  </MonoLabel>
                  <p className="mb-0 mt-1">
                    {unmappedProposal.proposal.aliases.join(" · ")}
                  </p>
                </div>
              ) : null}
              {unmappedProposal.proposal.relations.length > 0 ? (
                <div>
                  <MonoLabel as="div" size="label">
                    Suggested relationships
                  </MonoLabel>
                  <p className="mb-0 mt-1">
                    {unmappedProposal.proposal.relations
                      .map(
                        (relation) =>
                          `${relation.relation_type}: ${relation.target_slugs.join(", ")}`,
                      )
                      .join(" · ")}
                  </p>
                </div>
              ) : null}
              {unmappedProposal.proposal.reasoning ? (
                <div>
                  <MonoLabel as="div" size="label">
                    Reasoning
                  </MonoLabel>
                  <p className="mb-0 mt-1">
                    {unmappedProposal.proposal.reasoning}
                  </p>
                </div>
              ) : null}
              {unmappedProposal.proposal.recommended_action ===
              "needs_review" ? (
                <InfoBadge tone="warning">
                  AI could not make a safe recommendation. The tag remains
                  unmapped.
                </InfoBadge>
              ) : null}
            </div>
          ) : null
        }
        confirmLabel={
          unmappedProposal?.proposal.recommended_action === "needs_review"
            ? "Close"
            : "Apply proposal"
        }
        onConfirm={
          unmappedProposal?.proposal.recommended_action === "needs_review"
            ? () => setUnmappedProposal(null)
            : applyUnmappedProposal
        }
        onError={(error) =>
          toast.error(
            error instanceof ApiError
              ? error.message
              : "Failed to apply genre proposal",
          )
        }
        ariaLabel="Review AI genre proposal"
      />
    </main>
  );
}
