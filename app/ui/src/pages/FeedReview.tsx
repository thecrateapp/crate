import { useState } from "react";
import { useSearchParams } from "react-router";
import {
  CalendarDays,
  Check,
  Database,
  ExternalLink,
  FileText,
  Loader2,
  MapPin,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  ModalBody,
  ModalFooter,
  ModalHeader,
  AppModal,
  ModalCloseButton,
} from "@crate/ui/primitives/AppModal";
import { Badge } from "@crate/ui/shadcn/badge";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import {
  OpsPageHero,
  OpsPanel,
  OpsStatTile,
} from "@/components/admin/ops-surfaces";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { useTaskPoll } from "@/hooks/use-task-poll";
import { cn } from "@/lib/utils";

type ReviewStatus = "pending" | "accepted" | "rejected";

interface EnrichmentResult {
  operation?: string;
  artist_id?: number | null;
  artist_name?: string | null;
  reason?: string;
  candidates?: FeedArtistAssociationCandidate[];
  classification?: string;
  cluster_type?: string;
  confidence?: number;
  rationale?: string;
  reasons?: string[];
  members?: FeedClusterMember[];
  shows?: ExtractedShowProposal[];
  summary?: string;
  key_points?: string[];
  warnings?: string[];
  generated_at?: string;
}

interface FeedArtistAssociationCandidate {
  artist_id: number;
  artist_name: string;
  artist_slug?: string | null;
  score?: number;
  confidence?: number;
  reasons?: string[];
}

interface FeedClusterMember {
  item_id: number;
  role: "representative" | "related";
  reason: string;
  title: string;
  source_kind: string;
  canonical_url?: string | null;
  published_at?: string | null;
}

interface ExtractedShowProposal {
  event_date: string;
  local_time?: string | null;
  venue?: string | null;
  address_line1?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
  country?: string | null;
  country_code?: string | null;
  url?: string | null;
  tickets_url?: string | null;
  confidence?: number;
  evidence?: string;
}

interface FeedEnrichment {
  id: number;
  item_id: number;
  status: "pending" | "ready" | "failed" | "rejected" | "stale";
  review_status: ReviewStatus;
  source_content_hash: string;
  current_content_hash: string;
  language: string;
  result_json: EnrichmentResult;
  model?: string | null;
  prompt_version: string;
  error?: string | null;
  rejection_reason?: string | null;
  reviewed_at?: string | null;
  applied_at?: string | null;
  applied_show_ids?: number[];
  cluster_applied_at?: string | null;
  cluster_applied_item_ids?: number[];
  cluster_reverted_at?: string | null;
  title: string;
  item_kind: string;
  source_url: string;
  canonical_url?: string | null;
  excerpt?: string | null;
  published_at?: string | null;
  source_kind: string;
  feed_source_url?: string | null;
  artist_url?: string | null;
  artist_name?: string | null;
  associated_artist_id?: number | null;
  artist_association_method?: string | null;
  artist_association_confidence?: number | null;
  artist_associated_at?: string | null;
  artist_associated_by_user_id?: number | null;
  follow_up_task_id?: string | null;
}

interface ReviewResponse {
  items: FeedEnrichment[];
}

const REVIEW_FILTERS: Array<{ value: ReviewStatus; label: string }> = [
  { value: "pending", label: "Pending review" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
];

function formatDate(value?: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatEventDate(value?: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    date,
  );
}

function sourceLabel(source: string) {
  return source.replace(/_/g, " ");
}

function statusClasses(status: ReviewStatus) {
  if (status === "accepted") {
    return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
  }
  if (status === "rejected") {
    return "border-red-400/25 bg-red-400/10 text-red-200";
  }
  return "border-amber-400/25 bg-amber-400/10 text-amber-200";
}

function formatClassification(value?: string) {
  return value ? value.replace(/_/g, " ") : "Unknown";
}

function proposalPreview(result: EnrichmentResult, fallback?: string | null) {
  if (result.operation === "associate_artist") {
    if (result.artist_id && result.artist_name) {
      const confidence =
        typeof result.confidence === "number"
          ? ` · ${Math.round(result.confidence * 100)}% confidence`
          : "";
      return `Associate with ${result.artist_name}${confidence}`;
    }
    return "No artist association selected";
  }
  if (result.summary) return result.summary;
  if (result.members?.length) {
    return `${result.members.length} related items · ${formatClassification(
      result.cluster_type,
    )}`;
  }
  if (result.operation === "cluster") {
    return result.rationale || "No coherent cluster identified.";
  }
  if (result.shows?.length) {
    const label = result.shows.length === 1 ? "show" : "shows";
    return `${result.shows.length} ${label} extracted for review`;
  }
  if (result.classification) {
    const confidence =
      typeof result.confidence === "number"
        ? ` · ${Math.round(result.confidence * 100)}% confidence`
        : "";
    return `Classified as ${formatClassification(
      result.classification,
    )}${confidence}`;
  }
  return fallback || "No proposal available.";
}

export function FeedReview() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawFilter = searchParams.get("review_status");
  const reviewStatus: ReviewStatus = REVIEW_FILTERS.some(
    (filter) => filter.value === rawFilter,
  )
    ? (rawFilter as ReviewStatus)
    : "pending";
  const [selected, setSelected] = useState<FeedEnrichment | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const url = `/api/admin/external-feeds/enrichments/review?review_status=${reviewStatus}&limit=100`;
  const { data, loading, error, refetch } = useApi<ReviewResponse>(url);
  const { pollTask } = useTaskPoll();
  const items = data?.items ?? [];

  function selectFilter(value: ReviewStatus) {
    const next = new URLSearchParams(searchParams);
    next.set("review_status", value);
    setSearchParams(next);
  }

  function openReview(item: FeedEnrichment) {
    setSelected(item);
    setRejectionReason(item.rejection_reason ?? "");
  }

  function closeReview() {
    if (busyId !== null) return;
    setSelected(null);
    setRejectionReason("");
  }

  async function reviewItem(decision: "accept" | "reject") {
    if (!selected) return;
    const reason = rejectionReason.trim();
    if (decision === "reject" && !reason) {
      toast.error("Add a reason before rejecting the proposal");
      return;
    }
    setBusyId(selected.id);
    try {
      const response = await api<{
        follow_up_task_id?: string | null;
        cluster_task_id?: string | null;
      }>(
        `/api/admin/external-feeds/enrichments/${selected.id}/review`,
        "POST",
        {
          decision,
          rejection_reason: decision === "reject" ? reason : null,
        },
      );
      const followUpTaskId =
        response.follow_up_task_id ?? response.cluster_task_id;
      if (followUpTaskId) {
        const isShowExtraction = Boolean(response.follow_up_task_id);
        toast.success(
          isShowExtraction
            ? "Proposal accepted; show extraction queued"
            : "Artist association accepted; clustering queued",
        );
        pollTask(
          followUpTaskId,
          () => {
            void refetch();
            toast.success(
              isShowExtraction
                ? "Show extraction is ready for review"
                : "Clustering is ready for review",
            );
          },
          (taskError) => {
            toast.error(
              taskError ||
                (isShowExtraction
                  ? "Show extraction failed"
                  : "Clustering failed"),
            );
          },
          3000,
          120000,
        );
      } else {
        toast.success(
          decision === "accept" ? "Proposal accepted" : "Proposal rejected",
        );
      }
      setSelected(null);
      setRejectionReason("");
      refetch();
    } catch (reviewError) {
      toast.error(
        reviewError instanceof Error && reviewError.message
          ? reviewError.message
          : "Failed to save the review",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function applyShows() {
    if (!selected || selected.review_status !== "accepted") return;
    setBusyId(selected.id);
    try {
      const result = await api<{
        show_ids: number[];
        already_applied: boolean;
      }>(
        `/api/admin/external-feeds/enrichments/${selected.id}/apply-shows`,
        "POST",
      );
      setSelected((current) =>
        current
          ? {
              ...current,
              applied_at: current.applied_at || new Date().toISOString(),
              applied_show_ids: result.show_ids,
            }
          : current,
      );
      toast.success(
        result.already_applied
          ? "Shows are already in the catalogue"
          : `${result.show_ids.length} show${
              result.show_ids.length === 1 ? "" : "s"
            } added to the catalogue`,
      );
      refetch();
    } catch (applyError) {
      toast.error(
        applyError instanceof Error && applyError.message
          ? applyError.message
          : "Failed to add shows to the catalogue",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function applyCluster() {
    if (
      !selected ||
      selected.review_status !== "accepted" ||
      selected.result_json.operation !== "cluster"
    ) {
      return;
    }
    setBusyId(selected.id);
    try {
      const result = await api<{
        related_item_ids: number[];
        already_applied: boolean;
      }>(
        `/api/admin/external-feeds/enrichments/${selected.id}/apply-cluster`,
        "POST",
      );
      setSelected((current) =>
        current
          ? {
              ...current,
              cluster_applied_at:
                current.cluster_applied_at || new Date().toISOString(),
              cluster_applied_item_ids: result.related_item_ids,
              cluster_reverted_at: null,
            }
          : current,
      );
      toast.success(
        result.already_applied
          ? "Related items are already hidden"
          : `${result.related_item_ids.length} related item${
              result.related_item_ids.length === 1 ? "" : "s"
            } hidden from the feed`,
      );
      refetch();
    } catch (applyError) {
      toast.error(
        applyError instanceof Error && applyError.message
          ? applyError.message
          : "Failed to hide related items",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function revertCluster() {
    if (
      !selected ||
      selected.review_status !== "accepted" ||
      selected.result_json.operation !== "cluster"
    ) {
      return;
    }
    setBusyId(selected.id);
    try {
      const result = await api<{
        restored_item_ids: number[];
        already_reverted: boolean;
      }>(
        `/api/admin/external-feeds/enrichments/${selected.id}/revert-cluster`,
        "POST",
      );
      setSelected((current) =>
        current
          ? {
              ...current,
              cluster_reverted_at: new Date().toISOString(),
              cluster_applied_item_ids: [],
            }
          : current,
      );
      toast.success(
        result.already_reverted
          ? "Related items are already visible"
          : `${result.restored_item_ids.length} related item${
              result.restored_item_ids.length === 1 ? "" : "s"
            } restored to the feed`,
      );
      refetch();
    } catch (revertError) {
      toast.error(
        revertError instanceof Error && revertError.message
          ? revertError.message
          : "Failed to restore related items",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <OpsPageHero
        icon={Sparkles}
        title="Feed review"
        description="Review AI proposals generated from allowlisted external feed sources before they become part of the curated feed."
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => refetch()}
            disabled={loading}
          >
            <RefreshCw size={15} className={cn(loading && "animate-spin")} />
            Refresh
          </Button>
        }
      >
        <Badge variant="outline">Source text remains unchanged</Badge>
        <Badge variant="outline">Current content only</Badge>
      </OpsPageHero>

      <div className="grid gap-4 sm:grid-cols-3">
        <OpsStatTile
          icon={FileText}
          label="Visible proposals"
          value={items.length}
          caption={
            REVIEW_FILTERS.find((filter) => filter.value === reviewStatus)
              ?.label
          }
          tone={reviewStatus === "pending" ? "warning" : "default"}
        />
        <OpsStatTile
          icon={Check}
          label="Content safety"
          value="Versioned"
          caption="Hash and prompt provenance are retained"
          tone="success"
        />
        <OpsStatTile
          icon={Sparkles}
          label="AI mode"
          value="On demand"
          caption="No automatic mutations"
          tone="primary"
        />
      </div>

      <OpsPanel
        icon={FileText}
        title="Proposals"
        description="Only ready proposals whose source hash still matches the current feed item are shown."
        action={
          <div
            className="flex flex-wrap gap-1"
            role="tablist"
            aria-label="Review status"
          >
            {REVIEW_FILTERS.map((filter) => (
              <Button
                key={filter.value}
                type="button"
                size="sm"
                variant={reviewStatus === filter.value ? "secondary" : "ghost"}
                role="tab"
                aria-selected={reviewStatus === filter.value}
                onClick={() => selectFilter(filter.value)}
              >
                {filter.label}
              </Button>
            ))}
          </div>
        }
      >
        {error ? (
          <ErrorState
            message="Failed to load feed proposals"
            onRetry={refetch}
          />
        ) : loading && !data ? (
          <div className="flex items-center gap-2 py-16 text-sm text-white/55">
            <Loader2 size={16} className="animate-spin" />
            Loading proposals…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-md border border-dashed border-white/10 px-6 py-14 text-center">
            <FileText size={24} className="mx-auto mb-3 text-white/30" />
            <p className="font-medium text-white/80">
              No proposals in this view
            </p>
            <p className="mt-1 text-sm text-white/45">
              Generate a summary from an external feed item to start a review.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <FeedProposalCard
                key={item.id}
                item={item}
                onReview={openReview}
              />
            ))}
          </div>
        )}
      </OpsPanel>

      <AppModal
        open={selected !== null}
        onClose={closeReview}
        maxWidthClassName="sm:max-w-3xl"
        panelClassName="max-h-[90vh]"
      >
        {selected ? (
          <>
            <ModalHeader className="px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap gap-2">
                    <Badge className={statusClasses(selected.review_status)}>
                      {selected.review_status}
                    </Badge>
                    <Badge variant="outline">
                      {sourceLabel(selected.source_kind)}
                    </Badge>
                    {selected.applied_show_ids?.length ? (
                      <Badge className="border-emerald-400/25 bg-emerald-400/10 text-emerald-200">
                        In catalogue
                      </Badge>
                    ) : null}
                  </div>
                  <h2 className="break-words text-xl font-semibold text-white">
                    {selected.title}
                  </h2>
                  <p className="mt-1 break-words text-sm text-white/50">
                    {selected.artist_name || "Unknown artist"} ·{" "}
                    {formatDate(selected.published_at)}
                  </p>
                </div>
                <ModalCloseButton
                  onClick={closeReview}
                  aria-label="Close review"
                />
              </div>
            </ModalHeader>
            <ModalBody className="space-y-5 px-5 py-5">
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
                  AI proposal
                </h3>
                {selected.result_json.operation === "associate_artist" ? (
                  <ArtistAssociationProposal result={selected.result_json} />
                ) : selected.result_json.members?.length ? (
                  <div className="space-y-3 rounded-md border border-primary/15 bg-primary/[0.06] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-medium text-white/85">
                        Related items
                      </h4>
                      <Badge variant="outline">
                        {formatClassification(
                          selected.result_json.cluster_type,
                        )}
                      </Badge>
                      {typeof selected.result_json.confidence === "number" ? (
                        <span className="text-xs text-white/45">
                          {Math.round(selected.result_json.confidence * 100)}%
                          confidence
                        </span>
                      ) : null}
                    </div>
                    {selected.result_json.rationale ? (
                      <p className="text-sm leading-6 text-white/70">
                        {selected.result_json.rationale}
                      </p>
                    ) : null}
                    <div className="space-y-2">
                      {selected.result_json.members.map((member) => (
                        <div
                          key={member.item_id}
                          className="rounded-md border border-white/10 bg-black/15 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-white/85">
                              {member.title}
                            </span>
                            <Badge variant="outline">{member.role}</Badge>
                            <span className="text-xs text-white/40">
                              {sourceLabel(member.source_kind)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-white/50">
                            {member.reason}
                          </p>
                          {member.canonical_url ? (
                            <a
                              href={member.canonical_url}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80"
                            >
                              <ExternalLink size={13} />
                              Open source
                            </a>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : selected.result_json.operation === "cluster" ? (
                  <div className="space-y-3 rounded-md border border-primary/15 bg-primary/[0.06] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-medium text-white/85">
                        Cluster review
                      </h4>
                      <Badge variant="outline">
                        {formatClassification(
                          selected.result_json.cluster_type,
                        )}
                      </Badge>
                      {typeof selected.result_json.confidence === "number" ? (
                        <span className="text-xs text-white/45">
                          {Math.round(selected.result_json.confidence * 100)}%
                          confidence
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm leading-6 text-white/70">
                      {selected.result_json.rationale ||
                        "No coherent cluster was identified."}
                    </p>
                  </div>
                ) : selected.result_json.shows?.length ? (
                  <div className="space-y-3 rounded-md border border-primary/15 bg-primary/[0.06] p-4">
                    <div className="flex items-center gap-2">
                      <CalendarDays size={16} className="text-primary" />
                      <h4 className="text-sm font-medium text-white/85">
                        Extracted shows
                      </h4>
                      <Badge variant="outline">
                        {selected.result_json.shows.length}
                      </Badge>
                    </div>
                    <div className="space-y-2">
                      {selected.result_json.shows.map((show, index) => (
                        <div
                          key={`${show.event_date}-${
                            show.venue || "venue"
                          }-${index}`}
                          className="rounded-md border border-white/10 bg-black/15 p-3"
                        >
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/85">
                            <span className="font-medium">
                              {formatEventDate(show.event_date)}
                            </span>
                            {show.local_time ? (
                              <span className="text-white/55">
                                {show.local_time}
                              </span>
                            ) : null}
                            {typeof show.confidence === "number" ? (
                              <span className="text-xs text-white/45">
                                {Math.round(show.confidence * 100)}% confidence
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/65">
                            <span className="inline-flex items-center gap-1">
                              <MapPin size={14} />
                              {show.venue || "Venue not stated"}
                            </span>
                            <span>
                              {[show.city, show.region, show.country]
                                .filter(Boolean)
                                .join(", ") || "Location not stated"}
                            </span>
                          </div>
                          {show.evidence ? (
                            <p className="mt-2 text-xs leading-5 text-white/45">
                              {show.evidence}
                            </p>
                          ) : null}
                          {show.tickets_url || show.url ? (
                            <div className="mt-2 flex flex-wrap gap-3 text-xs">
                              {show.tickets_url ? (
                                <a
                                  href={show.tickets_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-primary hover:text-primary/80"
                                >
                                  <ExternalLink size={13} />
                                  Tickets
                                </a>
                              ) : null}
                              {show.url ? (
                                <a
                                  href={show.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-primary hover:text-primary/80"
                                >
                                  <ExternalLink size={13} />
                                  Event page
                                </a>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : selected.result_json.classification ? (
                  <div className="space-y-3 rounded-md border border-primary/15 bg-primary/[0.06] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {formatClassification(
                          selected.result_json.classification,
                        )}
                      </Badge>
                      {typeof selected.result_json.confidence === "number" ? (
                        <span className="text-xs text-white/45">
                          {Math.round(selected.result_json.confidence * 100)}%
                          confidence
                        </span>
                      ) : null}
                    </div>
                    {selected.result_json.reasons?.length ? (
                      <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-white/75">
                        {selected.result_json.reasons.map((reason) => (
                          <li key={reason} className="break-words">
                            {reason}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : (
                  <p className="break-words rounded-md border border-primary/15 bg-primary/[0.06] p-4 text-sm leading-6 text-white/80">
                    {selected.result_json.summary ||
                      "No summary was generated."}
                  </p>
                )}
              </section>

              {selected.result_json.key_points?.length ? (
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
                    Key points
                  </h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-white/70">
                    {selected.result_json.key_points.map((point) => (
                      <li key={point} className="break-words">
                        {point}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {selected.result_json.warnings?.length ? (
                <section className="space-y-2 rounded-md border border-amber-400/20 bg-amber-400/[0.06] p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200/70">
                    Warnings
                  </h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-amber-100/80">
                    {selected.result_json.warnings.map((warning) => (
                      <li key={warning} className="break-words">
                        {warning}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
                  Source context
                </h3>
                <p className="break-words text-sm leading-6 text-white/60">
                  {selected.excerpt || "No excerpt was stored for this item."}
                </p>
                <div className="flex flex-wrap items-center gap-3 text-xs text-white/40">
                  <span>Model: {selected.model || "Unknown"}</span>
                  <span>Prompt: {selected.prompt_version}</span>
                  <span>Language: {selected.language}</span>
                </div>
                <div className="flex flex-wrap gap-3">
                  <a
                    href={selected.canonical_url || selected.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-w-0 items-center gap-1 text-sm text-primary hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    <ExternalLink size={14} />
                    Open source
                  </a>
                </div>
              </section>

              {selected.review_status === "pending" ? (
                <div className="space-y-2">
                  <label
                    htmlFor="rejection-reason"
                    className="text-sm font-medium text-white/75"
                  >
                    Rejection reason
                  </label>
                  <Input
                    id="rejection-reason"
                    name="rejection_reason"
                    autoComplete="off"
                    value={rejectionReason}
                    onChange={(event) => setRejectionReason(event.target.value)}
                    placeholder="Explain why this proposal should not be used…"
                    className="min-h-10"
                  />
                  <p className="text-xs text-white/35">
                    Required only when rejecting. Acceptance records the current
                    proposal and its provenance.
                  </p>
                </div>
              ) : selected.rejection_reason ? (
                <p className="break-words text-sm text-red-200/80">
                  Rejection reason: {selected.rejection_reason}
                </p>
              ) : null}
            </ModalBody>
            {selected.review_status === "pending" ? (
              <ModalFooter className="flex flex-wrap justify-end gap-2 px-5 py-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void reviewItem("reject")}
                  disabled={busyId !== null}
                >
                  {busyId === selected.id ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <X size={15} />
                  )}
                  Reject
                </Button>
                <Button
                  type="button"
                  onClick={() => void reviewItem("accept")}
                  disabled={busyId !== null}
                >
                  {busyId === selected.id ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Check size={15} />
                  )}
                  Accept proposal
                </Button>
              </ModalFooter>
            ) : selected.review_status === "accepted" &&
              selected.result_json.shows?.length ? (
              <ModalFooter className="flex flex-wrap justify-end gap-2 px-5 py-4">
                <Button
                  type="button"
                  onClick={() => void applyShows()}
                  disabled={
                    busyId !== null ||
                    Boolean(selected.applied_show_ids?.length)
                  }
                >
                  {busyId === selected.id ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : selected.applied_show_ids?.length ? (
                    <Check size={15} />
                  ) : (
                    <Database size={15} />
                  )}
                  {selected.applied_show_ids?.length
                    ? "Already in catalogue"
                    : "Add shows to catalogue"}
                </Button>
              </ModalFooter>
            ) : selected.review_status === "accepted" &&
              selected.result_json.operation === "cluster" &&
              selected.result_json.members?.length ? (
              <ModalFooter className="flex flex-wrap justify-end gap-2 px-5 py-4">
                <Button
                  type="button"
                  variant={
                    selected.cluster_applied_item_ids?.length
                      ? "outline"
                      : "default"
                  }
                  onClick={() =>
                    void (selected.cluster_applied_item_ids?.length
                      ? revertCluster()
                      : applyCluster())
                  }
                  disabled={busyId !== null}
                >
                  {busyId === selected.id ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : selected.cluster_applied_item_ids?.length ? (
                    <RefreshCw size={15} />
                  ) : (
                    <Database size={15} />
                  )}
                  {selected.cluster_applied_item_ids?.length
                    ? "Restore related items"
                    : "Hide related items"}
                </Button>
              </ModalFooter>
            ) : null}
          </>
        ) : null}
      </AppModal>
    </div>
  );
}

function FeedProposalCard({
  item,
  onReview,
}: {
  item: FeedEnrichment;
  onReview: (item: FeedEnrichment) => void;
}) {
  return (
    <article className="[content-visibility:auto] [contain-intrinsic-size:0_160px] rounded-md border border-white/8 bg-black/15 p-4 transition-colors hover:border-white/15">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={statusClasses(item.review_status)}>
              {item.review_status}
            </Badge>
            <Badge variant="outline">{sourceLabel(item.source_kind)}</Badge>
            {item.applied_show_ids?.length ? (
              <Badge className="border-emerald-400/25 bg-emerald-400/10 text-emerald-200">
                In catalogue
              </Badge>
            ) : null}
            {item.associated_artist_id ? (
              <Badge className="border-sky-400/25 bg-sky-400/10 text-sky-200">
                Artist associated
              </Badge>
            ) : null}
            <span className="text-xs text-white/35">
              {formatDate(item.published_at)}
            </span>
          </div>
          <div className="min-w-0">
            <h3 className="break-words text-base font-semibold text-white/90">
              {item.title}
            </h3>
            <p className="truncate text-sm text-white/50">
              {item.artist_name || "Unknown artist"}
            </p>
          </div>
          <p className="line-clamp-2 break-words text-sm leading-6 text-white/55">
            {proposalPreview(item.result_json, item.excerpt)}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={() => onReview(item)}
        >
          {item.review_status === "pending" ? "Review proposal" : "View review"}
        </Button>
      </div>
    </article>
  );
}

function ArtistAssociationProposal({ result }: { result: EnrichmentResult }) {
  const selectedId = result.artist_id;
  return (
    <div className="space-y-4 rounded-md border border-primary/15 bg-primary/[0.06] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-medium text-white/85">
          Artist association
        </h4>
        {typeof result.confidence === "number" ? (
          <Badge variant="outline">
            {Math.round(result.confidence * 100)}% confidence
          </Badge>
        ) : null}
      </div>
      {selectedId && result.artist_name ? (
        <div className="rounded-md border border-emerald-400/20 bg-emerald-400/[0.06] p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-200/70">
            Selected artist
          </p>
          <p className="mt-1 text-sm font-medium text-white/90">
            {result.artist_name}
          </p>
        </div>
      ) : (
        <p className="rounded-md border border-amber-400/20 bg-amber-400/[0.06] p-3 text-sm text-amber-100/80">
          The model did not select a safe artist association.
        </p>
      )}
      {result.reason ? (
        <p className="text-sm leading-6 text-white/70">{result.reason}</p>
      ) : null}
      {result.candidates?.length ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
            Candidates considered
          </p>
          {result.candidates.map((candidate) => (
            <div
              key={candidate.artist_id}
              className={cn(
                "rounded-md border bg-black/15 p-3",
                candidate.artist_id === selectedId
                  ? "border-emerald-400/30"
                  : "border-white/10",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-white/85">
                  {candidate.artist_name}
                </span>
                {candidate.artist_id === selectedId ? (
                  <Badge className="border-emerald-400/25 bg-emerald-400/10 text-emerald-200">
                    Selected
                  </Badge>
                ) : null}
                {typeof candidate.score === "number" ? (
                  <span className="text-xs text-white/40">
                    {Math.round(candidate.score * 100)}% match
                  </span>
                ) : null}
              </div>
              {candidate.reasons?.length ? (
                <p className="mt-1 text-xs leading-5 text-white/50">
                  {candidate.reasons.join(" · ")}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
