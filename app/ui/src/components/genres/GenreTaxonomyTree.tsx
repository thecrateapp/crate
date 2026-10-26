import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useId,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import {
  Copy,
  Disc3,
  Globe,
  ListMusic,
  Loader2,
  Save,
  Tag,
  Trash2,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { useTaskPoll } from "@/hooks/use-task-poll";
import { ApiError, api } from "@/lib/api";
import { useActionLLMStatus } from "@/hooks/use-llm";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { GenrePill } from "@crate/ui/domain/genres/GenrePill";
import { Bot, ChevronRight } from "@crate/ui/icons";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { Button } from "@crate/ui/shadcn/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@crate/ui/shadcn/tooltip";
import { GenreEqEditor } from "@/components/genres/GenreEqEditor";
import { GenreManagementSection } from "@/components/genres/GenreManagementSection";
import {
  RELATION_EDITOR_CONFIG,
  sameTaxonomyRelations,
  TaxonomyDerivedRelationField,
  TaxonomyRelationField,
} from "@/components/genres/TaxonomyRelationField";
import { ImageCropUpload } from "@/components/ImageCropUpload";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ActionIconButton } from "@crate/ui/primitives/ActionIconButton";

export interface TaxonomyNode {
  slug: string;
  name: string;
  origin?: "core" | "overlay";
  description: string | null;
  cover_url?: string | null;
  musicbrainz_mbid: string | null;
  wikidata_url: string | null;
  top_level: boolean;
  parent_slugs: string[];
  children_slugs: string[];
  related_slugs: string[];
  influenced_by_slugs: string[];
  influences_slugs: string[];
  fusion_of_slugs: string[];
  fusion_genre_slugs: string[];
  alias_names: string[];
  artist_count: number;
  album_count: number;
  track_count?: number;
  raw_tag_count?: number;
  mapped_raw_tags?: string[];
  catalog_track_count?: number;
  catalog_track_share_pct?: number;
  listening_share_90d_pct?: number | null;
  eq_gains: number[] | null;
  eq_preset_source: string | null;
  eq_preset_inherited_from: string | null;
}

export interface TaxonomyTree {
  nodes: TaxonomyNode[];
  top_level_slugs: string[];
  core_taxonomy?: {
    taxonomy_id: string;
    version: string;
    digest: string;
    signature_valid: boolean;
    key_id: string | null;
  };
}

interface TaxonomyNodeProposal {
  description: string;
  aliases: string[];
  eq_gains?: number[];
  eq_reasoning?: string;
  relations: {
    relation_type: string;
    target_slugs: string[];
    confidence: number;
    reasoning: string;
  }[];
  reasoning: string;
}

interface GenreDeleteResponse {
  ok: boolean;
  removed_artist_assignments: number;
  removed_album_assignments: number;
}

function genreDeleteSummary(result: GenreDeleteResponse) {
  const assignmentCount =
    result.removed_artist_assignments + result.removed_album_assignments;
  if (assignmentCount === 0) return "Deleted genre metadata";
  return `Removed ${assignmentCount} genre assignment${
    assignmentCount === 1 ? "" : "s"
  }`;
}

function matchesSearch(node: TaxonomyNode, query: string): boolean {
  const q = query.toLowerCase();
  return (
    node.name.includes(q) ||
    node.slug.includes(q) ||
    node.alias_names.some((a) => a.includes(q))
  );
}

function collectAncestors(
  slug: string,
  nodeMap: Map<string, TaxonomyNode>,
  result: Set<string>,
) {
  const node = nodeMap.get(slug);
  if (!node) return;
  for (const parent of node.parent_slugs) {
    if (!result.has(parent)) {
      result.add(parent);
      collectAncestors(parent, nodeMap, result);
    }
  }
}

function GenreManagementIconAction({
  label,
  icon: Icon,
  variant,
  disabled,
  busy,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  variant: "ghost";
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex"
          tabIndex={disabled ? 0 : undefined}
          role={disabled ? "group" : undefined}
          aria-label={disabled ? label : undefined}
        >
          <Button
            variant={variant}
            size="icon-lg"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {busy ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Icon aria-hidden="true" />
            )}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

// ── Detail Panel ────────────────────────────────────────────────

function NodeDetailPanel({
  node,
  nodeMap,
  onAction,
  actionBusy,
  onRefetch,
  onDeleted,
  canCurate,
  canCreatePlaylists,
}: {
  node: TaxonomyNode;
  nodeMap: Map<string, TaxonomyNode>;
  onAction: (key: string) => void;
  actionBusy: (key: string) => boolean;
  onRefetch?: () => void;
  onDeleted?: () => void;
  canCurate: boolean;
  canCreatePlaylists: boolean;
}) {
  const hasPreset = node.eq_gains !== null;
  const empty = node.artist_count === 0 && node.album_count === 0;
  const taxonomyAiStatus = useActionLLMStatus("genres.taxonomy.propose");
  const [descriptionDraft, setDescriptionDraft] = useState(
    node.description ?? "",
  );
  const [topLevelDraft, setTopLevelDraft] = useState(node.top_level);
  const [relationDrafts, setRelationDrafts] = useState<
    Record<string, string[]>
  >({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [proposal, setProposal] = useState<TaxonomyNodeProposal | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [coverBroken, setCoverBroken] = useState(false);
  const [coverVersion, setCoverVersion] = useState(0);
  const baselineNode = useRef(node);

  useEffect(() => {
    const previous = baselineNode.current;
    setDescriptionDraft((current) =>
      current === (previous.description ?? "")
        ? (node.description ?? "")
        : current,
    );
    setTopLevelDraft((current) =>
      current === previous.top_level ? node.top_level : current,
    );
    setRelationDrafts((current) => {
      const next = { ...current };
      for (const config of RELATION_EDITOR_CONFIG) {
        if (
          sameTaxonomyRelations(
            current[config.key] ?? previous[config.field] ?? [],
            previous[config.field] ?? [],
          )
        ) {
          next[config.key] = node[config.field] ?? [];
        }
      }
      return next;
    });
    baselineNode.current = node;
  }, [node]);

  useEffect(() => {
    setCoverBroken(false);
    setCoverVersion(0);
  }, [node.slug]);

  const coverUrl = node.cover_url
    ? `${node.cover_url}${node.cover_url.includes("?") ? "&" : "?"}v=${coverVersion}`
    : null;
  const refreshCover = () => {
    setCoverBroken(false);
    setCoverVersion(Date.now());
    onRefetch?.();
  };

  const saveMetadata = async () => {
    setSavingKey("metadata");
    try {
      await api(`/api/genres/taxonomy/${node.slug}`, "PATCH", {
        description: descriptionDraft,
        top_level: topLevelDraft,
      });
      toast.success("Genre metadata saved");
      onRefetch?.();
    } catch {
      toast.error("Failed to save genre metadata");
    } finally {
      setSavingKey(null);
    }
  };

  const changedRelations = RELATION_EDITOR_CONFIG.filter(
    (config) =>
      !sameTaxonomyRelations(
        relationDrafts[config.key] ?? node[config.field] ?? [],
        node[config.field] ?? [],
      ),
  );

  const saveRelationships = async () => {
    if (changedRelations.length === 0) return;
    setSavingKey("relationships");
    let savedCount = 0;
    const missingSlugs = new Set<string>();
    try {
      for (const config of changedRelations) {
        const result = await api<{ missing?: string[] }>(
          `/api/genres/taxonomy/${node.slug}/relations`,
          "PUT",
          {
            relation_type: config.key,
            target_slugs: relationDrafts[config.key] ?? [],
          },
        );
        savedCount += 1;
        result.missing?.forEach((slug) => missingSlugs.add(slug));
      }
      if (missingSlugs.size > 0) {
        toast.warning(
          `Saved with missing genres: ${[...missingSlugs].join(", ")}`,
        );
      } else {
        toast.success("Taxonomy relationships saved");
      }
      onRefetch?.();
    } catch {
      toast.error(
        savedCount > 0
          ? `Saved ${savedCount} relationship${savedCount === 1 ? "" : "s"}; remaining changes could not be saved`
          : "Failed to save taxonomy relationships",
      );
      if (savedCount > 0) onRefetch?.();
    } finally {
      setSavingKey(null);
    }
  };

  const inferNodeProposal = async () => {
    setSavingKey("proposal");
    try {
      const result = await api<TaxonomyNodeProposal>(
        `/api/genres/taxonomy/${node.slug}/proposal`,
        "POST",
      );
      setProposal(result);
      if (result.description) {
        setDescriptionDraft(result.description);
      }
      if (result.relations.length > 0) {
        setRelationDrafts((prev) => {
          const next = { ...prev };
          for (const relation of result.relations) {
            next[relation.relation_type] = relation.target_slugs;
          }
          return next;
        });
      }
      toast.success("AI proposal staged for review");
    } catch {
      toast.error("Failed to infer taxonomy node");
    } finally {
      setSavingKey(null);
    }
  };

  const applyProposalAliases = async () => {
    if (!proposal?.aliases.length) return;
    setSavingKey("aliases");
    try {
      const result = await api<{ applied?: string[]; skipped?: string[] }>(
        `/api/genres/taxonomy/${node.slug}/aliases`,
        "PUT",
        { alias_names: proposal.aliases },
      );
      const appliedCount = result.applied?.length ?? 0;
      const skippedCount = result.skipped?.length ?? 0;
      if (appliedCount > 0) {
        toast.success(`Applied ${appliedCount} aliases`);
      } else if (skippedCount > 0) {
        toast.warning("No aliases applied");
      }
      onRefetch?.();
    } catch {
      toast.error("Failed to apply aliases");
    } finally {
      setSavingKey(null);
    }
  };

  const deleteNode = async () => {
    setSavingKey("delete-node");
    try {
      const result = await api<GenreDeleteResponse>(
        `/api/genres/taxonomy/${encodeURIComponent(node.slug)}`,
        "DELETE",
      );
      toast.success(genreDeleteSummary(result));
      setDeleteOpen(false);
      onDeleted?.();
    } finally {
      setSavingKey(null);
    }
  };

  const hasNodeActions = (canCreatePlaylists && !empty) || canCurate;
  const nodeManagementActions = hasNodeActions ? (
    <TooltipProvider>
      <div className="flex flex-wrap items-center gap-2">
        {canCurate && taxonomyAiStatus?.available ? (
          <ActionIconButton
            variant="row"
            tone="primary"
            title="Enrich with AI"
            aria-busy={savingKey === "proposal" || undefined}
            onClick={inferNodeProposal}
            disabled={savingKey !== null && savingKey !== "proposal"}
          >
            {savingKey === "proposal" ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Bot aria-hidden="true" />
            )}
          </ActionIconButton>
        ) : null}
        {canCreatePlaylists && !empty ? (
          <GenreManagementIconAction
            label="Generate playlist"
            icon={ListMusic}
            variant="ghost"
            disabled={actionBusy("playlist")}
            busy={actionBusy("playlist")}
            onClick={() => onAction("playlist")}
          />
        ) : null}
        {canCurate ? (
          <GenreManagementIconAction
            label="Save genre metadata"
            icon={Save}
            variant="ghost"
            disabled={savingKey === "metadata"}
            busy={savingKey === "metadata"}
            onClick={saveMetadata}
          />
        ) : null}
        {canCurate ? (
          <ActionIconButton
            variant="row"
            tone="danger"
            title="Delete genre"
            disabled={savingKey === "delete-node"}
            aria-busy={savingKey === "delete-node" || undefined}
            onClick={() => setDeleteOpen(true)}
          >
            {savingKey === "delete-node" ? (
              <Loader2 aria-hidden="true" className="animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
          </ActionIconButton>
        ) : null}
      </div>
    </TooltipProvider>
  ) : null;

  const auxiliaryDetails = (
    <div className="space-y-4 border-t border-border-quiet pt-4">
      <div>
        <MonoLabel as="div" tone="accent" size="label" className="mb-2">
          References
        </MonoLabel>
        <div className="space-y-1.5">
          {node.musicbrainz_mbid ? (
            <div className="flex items-center gap-2">
              <a
                href={`https://musicbrainz.org/genre/${node.musicbrainz_mbid}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-accent-action-hi transition-colors hover:text-foreground"
              >
                <Globe size={12} />
                MusicBrainz
              </a>
              <ActionIconButton
                variant="row"
                title="Copy MBID"
                onClick={() => {
                  void navigator.clipboard.writeText(node.musicbrainz_mbid!);
                  toast.success("MBID copied");
                }}
              >
                <Copy aria-hidden="true" />
              </ActionIconButton>
              <span className="select-all font-mono text-[10px] text-text-muted">
                {node.musicbrainz_mbid}
              </span>
            </div>
          ) : (
            <div className="text-xs italic text-text-muted">
              No MusicBrainz MBID — run MB sync to match.
            </div>
          )}
          {node.wikidata_url ? (
            <div className="flex items-center gap-2">
              <a
                href={node.wikidata_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-accent-action-hi transition-colors hover:text-foreground"
              >
                <Globe size={12} />
                Wikidata
              </a>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Slug:</span>
            <span className="select-all font-mono text-[11px] text-text-secondary">
              {node.slug}
            </span>
          </div>
        </div>
      </div>

      {node.alias_names.length > 0 ? (
        <div className="border-t border-border-quiet pt-4">
          <MonoLabel as="div" tone="accent" size="label" className="mb-2">
            Aliases · {node.alias_names.length}
          </MonoLabel>
          <div className="flex flex-wrap gap-1.5">
            {node.alias_names.map((alias) => (
              <GenrePill
                key={alias}
                item={{ name: alias, slug: alias, source: node.slug }}
                className="border-border bg-transparent text-text-secondary"
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div
          data-slot="genre-node-header"
          className="flex flex-wrap items-start justify-between gap-3"
        >
          <div>
            <h3 className="text-lg font-semibold text-foreground capitalize font-display">
              {node.name}
            </h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {node.top_level && <InfoBadge tone="accent">top-level</InfoBadge>}
              <InfoBadge tone={hasPreset ? "accent" : "neutral"}>
                {node.eq_preset_source === "direct"
                  ? "direct preset"
                  : node.eq_preset_source === "inherited"
                    ? `inherits from ${node.eq_preset_inherited_from}`
                    : "no preset"}
              </InfoBadge>
              {empty && <InfoBadge>empty</InfoBadge>}
            </div>
          </div>
          {nodeManagementActions}
        </div>

        {!canCurate ? (
          <div className="grid gap-4 sm:grid-cols-[minmax(180px,240px)_minmax(0,1fr)]">
            <div className="relative aspect-[2/1] overflow-hidden rounded-md border border-border-quiet bg-card">
              {coverUrl && !coverBroken ? (
                <img
                  key={coverVersion}
                  src={coverUrl}
                  alt={`${node.name} genre cover`}
                  className="h-full w-full object-cover"
                  onError={() => setCoverBroken(true)}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-text-muted">
                  <Tag size={20} className="text-accent-action" />
                  <span className="text-xs">No genre cover</span>
                </div>
              )}
            </div>
            <div className="flex min-w-0 items-center text-sm leading-6 text-text-secondary">
              {node.description || (
                <span className="italic text-text-muted">
                  No description available.
                </span>
              )}
            </div>
          </div>
        ) : null}

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Users size={14} />
            {node.artist_count} artists
          </span>
          <span className="flex items-center gap-1.5">
            <Disc3 size={14} />
            {node.album_count} albums
          </span>
        </div>

        {canCurate ? (
          <GenreManagementSection
            title="Editorial Data"
            description="Maintain the canonical description, cover and taxonomy role. AI enrichment stages suggestions for review."
          >
            <div className="grid gap-4 sm:grid-cols-[minmax(180px,240px)_minmax(0,1fr)]">
              <div className="crate-form-field">
                <MonoLabel
                  as="div"
                  data-slot="form-field-label"
                  tone="subtle"
                  size="label"
                >
                  Cover image
                </MonoLabel>
                <div className="relative aspect-[2/1] overflow-hidden rounded-md border border-border-quiet bg-card">
                  {coverUrl && !coverBroken ? (
                    <img
                      key={coverVersion}
                      src={coverUrl}
                      alt={`${node.name} genre cover`}
                      className="h-full w-full object-cover"
                      onError={() => setCoverBroken(true)}
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-text-muted">
                      <Tag size={20} className="text-accent-action" />
                      <span className="text-xs">No genre cover</span>
                    </div>
                  )}
                  <ImageCropUpload
                    endpoint={`/api/genres/taxonomy/${encodeURIComponent(node.slug)}/cover`}
                    aspect={2}
                    onUploaded={refreshCover}
                    label="Edit cover"
                    className="absolute inset-0 z-10 flex items-end justify-center gap-1.5 bg-black/0 p-3 text-xs font-semibold text-white/0 transition hover:bg-black/35 hover:text-white/85 focus-visible:bg-black/35 focus-visible:text-accent-action-hi"
                  />
                </div>
              </div>
              <div className="crate-form-field">
                <label
                  htmlFor="genre-description"
                  className="font-mono text-label leading-[1.4] tracking-caps text-text-subtle"
                >
                  <MonoLabel
                    as="span"
                    data-slot="form-field-label"
                    tone="subtle"
                    size="label"
                  >
                    Description
                  </MonoLabel>
                </label>
                <textarea
                  id="genre-description"
                  value={descriptionDraft}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                  rows={4}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent-action/40"
                  placeholder="Short editorial description for this genre."
                />
                <label
                  htmlFor="genre-top-level"
                  className="inline-flex items-center gap-2 text-sm text-text-secondary"
                >
                  <input
                    id="genre-top-level"
                    type="checkbox"
                    checked={topLevelDraft}
                    onChange={(event) => setTopLevelDraft(event.target.checked)}
                    className="h-4 w-4 accent-accent-action"
                  />
                  <MonoLabel as="span" tone="subtle" size="label">
                    Top-level genre
                  </MonoLabel>
                </label>
              </div>
            </div>
            {proposal ? (
              <div className="rounded-md border border-accent-action/20 bg-accent-action/5 p-3 text-sm text-text-secondary">
                <MonoLabel as="div" tone="accent" size="eyebrow">
                  Enrichment proposal ready to review
                </MonoLabel>
                <p className="mb-0 mt-2 text-sm leading-5 text-text-muted">
                  {proposal.eq_gains?.length === 10
                    ? "Description, relationships and the 10-band EQ curve are staged for review. Save each section when it is ready; AI never writes these changes automatically."
                    : "Description and relationship suggestions are staged for review. Save each section when it is ready; AI never writes these changes automatically."}
                </p>
                {proposal.reasoning ? (
                  <p className="mb-0 mt-2">{proposal.reasoning}</p>
                ) : null}
                {proposal.aliases.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {proposal.aliases.map((alias) => (
                        <InfoBadge key={alias}>alias: {alias}</InfoBadge>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={savingKey === "aliases"}
                      onClick={applyProposalAliases}
                    >
                      {savingKey === "aliases" ? (
                        <Loader2 size={11} className="mr-1 animate-spin" />
                      ) : (
                        <Tag size={11} className="mr-1" />
                      )}
                      Apply aliases
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {auxiliaryDetails}
          </GenreManagementSection>
        ) : null}
        {!canCurate ? auxiliaryDetails : null}

        {/* EQ Preset — full editor, same as genre detail page */}
        {canCurate ? (
          <GenreManagementSection
            title="EQ Preset"
            description="Set the curve applied to tracks in this genre when Genre Adaptive is enabled."
          >
            <GenreEqEditor
              canonicalSlug={node.slug}
              canonicalName={node.name}
              initialGains={
                node.eq_preset_source === "direct" ? node.eq_gains : null
              }
              initialResolved={
                node.eq_preset_source === "inherited" &&
                node.eq_preset_inherited_from
                  ? {
                      gains: node.eq_gains ?? [],
                      source: "inherited",
                      slug: node.eq_preset_inherited_from,
                      name: node.eq_preset_inherited_from,
                    }
                  : node.eq_gains
                    ? {
                        gains: node.eq_gains,
                        source: "direct",
                        slug: node.slug,
                        name: node.name,
                      }
                    : null
              }
              aiProposalGains={proposal?.eq_gains ?? null}
              aiProposalReasoning={proposal?.eq_reasoning ?? null}
              embedded
              onSaved={onRefetch}
            />
          </GenreManagementSection>
        ) : null}

        {canCurate ? (
          <GenreManagementSection
            title="Relationships"
            description="Edit the genre’s place in the taxonomy graph and follow its connected nodes."
            actions={
              <Button
                variant="outline"
                size="sm"
                disabled={savingKey !== null || changedRelations.length === 0}
                onClick={saveRelationships}
              >
                {savingKey === "relationships" ? (
                  <Loader2 size={13} className="mr-1 animate-spin" />
                ) : (
                  <Save size={13} className="mr-1" />
                )}
                Save relationships
              </Button>
            }
          >
            {RELATION_EDITOR_CONFIG.map((config) => {
              const value =
                relationDrafts[config.key] ?? node[config.field] ?? [];
              const stagedProposal = proposal?.relations.find(
                (relation) => relation.relation_type === config.key,
              );
              return (
                <TaxonomyRelationField
                  key={config.key}
                  config={config}
                  value={value}
                  options={[...nodeMap.values()]}
                  sourceSlug={node.slug}
                  stagedProposal={stagedProposal}
                  onChange={(next) =>
                    setRelationDrafts((prev) => ({
                      ...prev,
                      [config.key]: next,
                    }))
                  }
                />
              );
            })}
            <TaxonomyDerivedRelationField
              label="Influences"
              helper="Derived reverse view: these genres list this genre under “Influenced by”. Edit the source relationship on each genre."
              value={node.influences_slugs}
              options={[...nodeMap.values()]}
            />
          </GenreManagementSection>
        ) : null}
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={`Delete ${node.name}?`}
          description="This removes the taxonomy node, aliases, relations, and all mapped raw genre assignments from artists and albums. This cannot be undone."
          confirmLabel="Delete Genre"
          tone="danger"
          onConfirm={deleteNode}
          onError={(error) =>
            toast.error(
              error instanceof ApiError
                ? `Failed to delete genre: ${error.message}`
                : "Failed to delete genre",
            )
          }
          eyebrow="Confirm action"
          consequence={`${node.name} · removes taxonomy, aliases, relations and mapped genre assignments`}
        />
      </div>
    </>
  );
}

// ── Main Component ──────────────────────────────────────────────

export function GenreTaxonomyTree({
  filter = "",
  hideEmpty = false,
  canCurate = false,
  canCreatePlaylists = false,
  onChanged,
  taxonomyData,
  onRefetch,
  selectedSlug: controlledSelectedSlug,
  onSelectionChange,
  showDetailPanel = true,
  detailPortalTarget,
}: {
  filter?: string;
  hideEmpty?: boolean;
  canCurate?: boolean;
  canCreatePlaylists?: boolean;
  onChanged?: () => void;
  taxonomyData?: TaxonomyTree | null;
  onRefetch?: () => void;
  selectedSlug?: string | null;
  onSelectionChange?: (slug: string | null) => void;
  showDetailPanel?: boolean;
  detailPortalTarget?: Element | null;
}) {
  const taxonomyApi = useApi<TaxonomyTree>(
    taxonomyData ? null : "/api/genres/taxonomy/tree",
  );
  const data = taxonomyData ?? taxonomyApi.data;
  const refetch = onRefetch ?? taxonomyApi.refetch;
  const { pollTask } = useTaskPoll();
  const search = filter;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [internalSelectedSlug, setInternalSelectedSlug] = useState<
    string | null
  >(null);
  const selectedSlug =
    controlledSelectedSlug === undefined
      ? internalSelectedSlug
      : controlledSelectedSlug;
  const selectionRef = useRef(selectedSlug);
  selectionRef.current = selectedSlug;
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const updateSelection = useCallback(
    (slug: string | null) => {
      if (controlledSelectedSlug === undefined) setInternalSelectedSlug(slug);
      onSelectionChange?.(slug);
    },
    [controlledSelectedSlug, onSelectionChange],
  );

  const nodeMap = useMemo(() => {
    const map = new Map<string, TaxonomyNode>();
    for (const node of data?.nodes ?? []) map.set(node.slug, node);
    return map;
  }, [data?.nodes]);

  useEffect(() => {
    if (!selectedSlug) return;
    const ancestors = new Set<string>();
    collectAncestors(selectedSlug, nodeMap, ancestors);
    if (ancestors.size) {
      setExpanded((prev) => new Set([...prev, ...ancestors]));
    }
  }, [selectedSlug, nodeMap]);

  const { visibleSlugs, autoExpanded } = useMemo(() => {
    if (!search.trim() || !data)
      return { visibleSlugs: null, autoExpanded: new Set<string>() };
    const q = search.trim().toLowerCase();
    const matches = new Set<string>();
    const ancestors = new Set<string>();
    for (const node of data.nodes) {
      if (matchesSearch(node, q)) {
        matches.add(node.slug);
        collectAncestors(node.slug, nodeMap, ancestors);
      }
    }
    return {
      visibleSlugs: new Set([...matches, ...ancestors]),
      autoExpanded: ancestors,
    };
  }, [search, data, nodeMap]);

  const nonEmptySlugs = useMemo(() => {
    if (!hideEmpty || !data) return null;
    const set = new Set<string>();
    const visited = new Set<string>();
    function mark(slug: string): boolean {
      if (visited.has(slug)) return set.has(slug);
      visited.add(slug);
      const node = nodeMap.get(slug);
      if (!node) return false;
      const selfHasContent = node.artist_count > 0 || node.album_count > 0;
      let childHasContent = false;
      for (const child of node.children_slugs) {
        if (mark(child)) childHasContent = true;
      }
      if (selfHasContent || childHasContent) {
        set.add(slug);
        // Also mark all ancestors so parent chain is visible
        for (const parent of node.parent_slugs) {
          const p = nodeMap.get(parent);
          if (p && !set.has(parent)) {
            set.add(parent);
          }
        }
        return true;
      }
      return false;
    }
    // Walk ALL nodes, not just top-level roots
    for (const node of data.nodes) mark(node.slug);
    return set;
  }, [hideEmpty, data, nodeMap]);

  const selectedNode = selectedSlug
    ? (nodeMap.get(selectedSlug) ?? null)
    : null;

  const runAction = useCallback(
    (key: string) => {
      if (busy[key] || !selectedSlug) return;
      if (key === "playlist" && !canCreatePlaylists) return;
      if (key !== "playlist") return;
      setBusy((prev) => ({ ...prev, [key]: true }));

      const actions: Record<
        string,
        {
          url: string;
          body: Record<string, unknown>;
          success: string;
          error: string;
        }
      > = {
        playlist: {
          url: `/api/genres/${selectedSlug}/playlist`,
          body: { limit: 50 },
          success: "Playlist generated",
          error: "Playlist generation failed",
        },
      };

      const action = actions[key];
      if (!action) {
        setBusy((prev) => ({ ...prev, [key]: false }));
        return;
      }

      void (async () => {
        try {
          const { task_id } = await api<{ task_id: string }>(
            action.url,
            "POST",
            action.body,
          );
          pollTask(
            task_id,
            () => {
              setBusy((prev) => ({ ...prev, [key]: false }));
              refetch();
              toast.success(action.success);
            },
            (err) => {
              setBusy((prev) => ({ ...prev, [key]: false }));
              toast.error(err || action.error);
            },
            3000,
            10 * 60 * 1000,
          );
        } catch {
          setBusy((prev) => ({ ...prev, [key]: false }));
          toast.error(action.error);
        }
      })();
    },
    [busy, canCreatePlaylists, selectedSlug, pollTask, refetch],
  );

  const isBusy = useCallback((key: string) => !!busy[key], [busy]);

  const treeId = useId();

  if (!data) return null;

  const toggleExpand = (slug: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const isExpanded = (slug: string) =>
    expanded.has(slug) || autoExpanded.has(slug);

  const renderNode = (
    slug: string,
    depth: number,
    path = slug,
  ): React.ReactNode => {
    const childrenId = `${treeId}-${encodeURIComponent(path)}`;
    const node = nodeMap.get(slug);
    if (!node) return null;
    if (visibleSlugs && !visibleSlugs.has(slug)) return null;
    if (nonEmptySlugs && !nonEmptySlugs.has(slug)) return null;

    const hasChildren = nonEmptySlugs
      ? node.children_slugs.some((c) => nonEmptySlugs.has(c))
      : node.children_slugs.length > 0;
    const open = isExpanded(slug);
    const isSelected = selectedSlug === slug;
    const hasPreset = node.eq_gains !== null;
    const empty = node.artist_count === 0 && node.album_count === 0;

    return (
      <div key={slug}>
        <div
          className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-0 text-left text-sm transition-colors ${
            isSelected
              ? "border-accent-action/40 bg-accent-action/10"
              : "border-white/6 bg-white/[0.02]"
          }`}
          style={{ paddingLeft: depth * 16 + 10 }}
        >
          {hasChildren ? (
            <ActionButton
              label={`${open ? "Collapse" : "Expand"} ${node.name}`}
              aria-expanded={open}
              aria-controls={childrenId}
              onClick={() => toggleExpand(slug)}
            >
              <ChevronRight
                data-admin-ux="genre-tree-expand"
                aria-hidden="true"
                className={`transition-transform ${open ? "rotate-90" : ""}`}
              />
            </ActionButton>
          ) : (
            <span className="w-11 flex-shrink-0" aria-hidden="true" />
          )}
          <button
            type="button"
            aria-pressed={isSelected}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-3 border-0 bg-transparent p-0 text-left text-sm"
            onClick={() => updateSelection(isSelected ? null : slug)}
          >
            <span
              className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                empty
                  ? "bg-white/15"
                  : hasPreset
                    ? "bg-accent-action"
                    : "bg-white/25"
              }`}
            />
            <MonoLabel
              as="span"
              className={`min-w-0 flex-1 truncate ${
                isSelected
                  ? "text-accent-action-hi"
                  : empty
                    ? "text-white/30 group-hover:text-accent-action-hi"
                    : node.top_level
                      ? "text-white group-hover:text-accent-action-hi"
                      : "text-white/75 group-hover:text-accent-action-hi"
              }`}
            >
              {node.name}
            </MonoLabel>
            {node.artist_count > 0 && (
              <span className="text-[10px] tabular-nums text-white/30 flex-shrink-0">
                {node.artist_count}
              </span>
            )}
          </button>
        </div>
        {hasChildren ? (
          <div id={childrenId} hidden={!open}>
            {open &&
              node.children_slugs.map((childSlug) =>
                renderNode(childSlug, depth + 1, `${path}/${childSlug}`),
              )}
          </div>
        ) : null}
      </div>
    );
  };

  const detail = selectedNode ? (
    <NodeDetailPanel
      key={selectedNode.slug}
      node={selectedNode}
      nodeMap={nodeMap}
      onAction={runAction}
      actionBusy={isBusy}
      onRefetch={refetch}
      onDeleted={() => {
        if (selectionRef.current === selectedNode.slug) updateSelection(null);
        refetch();
        onChanged?.();
      }}
      canCurate={canCurate}
      canCreatePlaylists={canCreatePlaylists}
    />
  ) : null;

  return (
    <>
      <div className={showDetailPanel ? "flex items-start gap-6" : "min-w-0"}>
        {/* Left: Tree */}
        <div className={showDetailPanel ? "w-80 flex-shrink-0" : "min-w-0"}>
          <div className="max-h-[calc(100vh-220px)] overflow-y-auto space-y-1 pr-1">
            {data.top_level_slugs.map((slug) => renderNode(slug, 0))}
          </div>
        </div>

        {/* Right: Detail */}
        {showDetailPanel ? (
          <div className="min-w-0 flex-1">
            {detail ? (
              // Sticks 1.5rem below Shell's fixed header (--app-header-h).
              <div className="rounded-md border border-white/8 bg-white/[0.02] p-6 sticky top-[calc(var(--app-header-h,0px)+1.5rem)]">
                {detail}
              </div>
            ) : (
              <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-white/10 text-sm text-white/30">
                Select a genre to view details
              </div>
            )}
          </div>
        ) : null}
      </div>
      {detailPortalTarget && !showDetailPanel && detail
        ? createPortal(
            <div className="rounded-md border border-white/8 bg-white/[0.02] p-4 sm:p-6">
              {detail}
            </div>,
            detailPortalTarget,
          )
        : null}
    </>
  );
}
