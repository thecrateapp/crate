import { useState } from "react";
import { Loader2 } from "@crate/ui/icons";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { toast } from "sonner";

import {
  ArtistBioProfile,
  type ArtistBioMember,
} from "@crate/ui/domain/ArtistBioProfile";
import { Button } from "@crate/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";
import { Textarea } from "@crate/ui/shadcn/textarea";

import { api } from "@/lib/api";
import { artistActionApiPath, artistPhotoApiUrl } from "@/lib/library-routes";
import { waitForTask } from "@/lib/tasks";
import type { ArtistData } from "./artistPageTypes";

interface ResearchSource {
  id: string;
  title: string;
  url: string;
  kind: string;
  excerpt: string;
}

interface ResearchMember {
  name: string;
  roles?: string[];
  from_year?: string | null;
  to_year?: string | null;
  source_ids?: string[];
}

interface ResearchReviewItem {
  kind: string;
  summary: string;
  source_ids?: string[];
}

type BioChangeStatus = "unchanged" | "added" | "removed" | "updated";

interface ResearchBioChange {
  status: BioChangeStatus;
  text: string;
  previous_text?: string | null;
  source_ids?: string[];
}

interface ResearchResult {
  proposal?: string;
  bio?: { paragraphs?: string[] };
  paragraphs?: string[];
  members?: {
    current?: ResearchMember[];
    former?: ResearchMember[];
  };
  current_members?: ResearchMember[];
  former_members?: ResearchMember[];
  bio_action?: "preserve" | "update";
  review_items?: ResearchReviewItem[];
  bio_changes?: ResearchBioChange[];
  claims?: { claim: string; source_ids: string[] }[];
  conflicts?: string[];
  warnings?: string[];
  sources?: ResearchSource[];
  model?: string;
}

type ReviewTab = "preview" | "review" | "edit" | "sources";

const MIN_SUBSTANTIAL_BIO_CHARS = 600;
const MIN_ACCEPTED_BIO_RATIO = 0.8;

interface ArtistBioResearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artist: ArtistData;
  currentBio: string;
  onApply: (bio: string) => Promise<void>;
}

function getProposalParagraphs(result: ResearchResult): string[] {
  const paragraphs = result.bio?.paragraphs ?? result.paragraphs;
  if (Array.isArray(paragraphs)) {
    return paragraphs.flatMap((paragraph) => {
      const trimmed = paragraph.trim();
      return trimmed ? [trimmed] : [];
    });
  }
  return result.proposal?.trim() ? [result.proposal.trim()] : [];
}

function getProposalText(result: ResearchResult): string {
  return getProposalParagraphs(result).join("\n\n");
}

function normalizeResearchResult(
  result: ResearchResult,
  currentBio: string,
): ResearchResult {
  const existing = currentBio.trim();
  if (!existing || existing.length < MIN_SUBSTANTIAL_BIO_CHARS) return result;

  const proposal = getProposalText(result);
  const resultRequestsUpdate = result.bio_action === "update";
  const proposalLosesDetail =
    proposal.length < existing.length * MIN_ACCEPTED_BIO_RATIO;
  if (resultRequestsUpdate && !proposalLosesDetail) return result;

  const warning = resultRequestsUpdate
    ? "The generated draft was shorter than the existing biography, so the current text was preserved for review."
    : "The research result did not confirm a safe biography update, so the current text was preserved for review.";

  return {
    ...result,
    bio_action: "preserve",
    proposal: existing,
    bio: { paragraphs: existing.split(/\n\s*\n/) },
    warnings: [...(result.warnings ?? []), warning].slice(0, 8),
  };
}

function toProfileMember(member: ResearchMember): ArtistBioMember {
  return {
    name: member.name,
    roles: member.roles,
    begin: member.from_year,
    end: member.to_year,
  };
}

function getProposalMembers(result: ResearchResult): ArtistBioMember[] {
  const current = result.members?.current ?? result.current_members ?? [];
  const former = result.members?.former ?? result.former_members ?? [];
  return [...current, ...former].flatMap((member) => {
    return member.name.trim() ? [toProfileMember(member)] : [];
  });
}

function ReviewTabs({
  activeTab,
  onChange,
}: {
  activeTab: ReviewTab;
  onChange: (tab: ReviewTab) => void;
}) {
  return (
    <SegmentedControl
      as="tabs"
      label="Biography research views"
      value={activeTab}
      onValueChange={onChange}
      items={[
        { value: "preview", label: "Listen preview" },
        { value: "review", label: "Review changes" },
        { value: "edit", label: "Edit" },
        { value: "sources", label: "Sources" },
      ]}
    />
  );
}

function ResearchSourceList({ sources }: { sources: ResearchSource[] }) {
  if (!sources.length) {
    return (
      <p className="text-sm text-text-muted">
        No usable sources were returned.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {sources.map((source) => (
        <a
          key={source.id}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="block border-b border-border-quiet py-3 transition-colors hover:text-accent-action-hi"
        >
          <span className="flex items-center gap-2 text-xs font-medium text-accent-action">
            {source.title}
          </span>
          <span className="mt-1 block line-clamp-3 text-xs leading-relaxed text-text-muted">
            {source.excerpt}
          </span>
        </a>
      ))}
    </div>
  );
}

function ReviewNotes({ result }: { result: ResearchResult }) {
  const notes = [...(result.conflicts ?? []), ...(result.warnings ?? [])];
  if (!notes.length) return null;

  return (
    <div className="rounded-md border border-state-warning/25 bg-state-warning/5 p-3 text-sm text-state-warning-text">
      <p className="mb-1 font-medium">Review notes</p>
      {notes.map((note) => (
        <p key={note} className="mt-1">
          {note}
        </p>
      ))}
    </div>
  );
}

function ReviewSummary({ result }: { result: ResearchResult }) {
  const findings = result.review_items ?? [];
  const warnings = result.warnings ?? [];
  const preserved = result.bio_action === "preserve";

  return (
    <div
      data-testid="artist-bio-review-summary"
      className="border-y border-border-quiet py-3"
    >
      <p className="text-sm font-medium text-text-secondary-strong">
        {preserved
          ? "Existing biography preserved"
          : "Biography update proposed"}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">
        {preserved
          ? "The current biography is used as the base. Only the findings below need review."
          : "The proposal keeps supported existing detail and adds only material findings from the sources."}
      </p>
      {findings.length ? (
        <ul className="mt-2 space-y-1 text-sm text-text-secondary">
          {findings.map((finding) => (
            <li
              key={`${finding.kind}-${finding.summary}-${
                finding.source_ids?.join(",") ?? ""
              }`}
            >
              <MonoLabel as="span" tone="accent" className="mr-2">
                {finding.kind.split("_").join(" ")}
              </MonoLabel>
              {finding.summary}
            </li>
          ))}
        </ul>
      ) : null}
      {warnings.length ? (
        <div className="mt-2 space-y-1 text-xs text-state-warning-text">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReviewChanges({ result }: { result: ResearchResult }) {
  const changes = result.bio_changes ?? [];
  if (!changes.length) {
    return (
      <p className="text-sm text-text-muted">
        No semantic biography changes were returned.
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="artist-bio-review-changes">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        <span className="text-accent-action-hi">Added</span>
        <span className="text-state-warning-text">Removed</span>
        <span className="text-state-warning-text">Updated</span>
      </div>
      <div className="space-y-2 text-sm leading-relaxed">
        {changes.map((change) => {
          const key = `${change.status}-${change.text}-${
            change.previous_text ?? ""
          }-${change.source_ids?.join(",") ?? ""}`;
          if (change.status === "updated") {
            return (
              <div
                key={key}
                data-testid="bio-change-updated"
                className="rounded-md border border-state-warning bg-state-warning/5 p-3"
              >
                {change.previous_text ? (
                  <p className="text-state-warning-text line-through">
                    {change.previous_text}
                  </p>
                ) : null}
                <p className="mt-1 text-accent-action-hi">{change.text}</p>
              </div>
            );
          }
          const className =
            change.status === "added"
              ? "text-accent-action-hi"
              : change.status === "removed"
                ? "text-state-warning-text line-through"
                : "text-text-secondary-strong";
          return (
            <p
              key={key}
              data-testid={`bio-change-${change.status}`}
              className={className}
            >
              {change.text}
            </p>
          );
        })}
      </div>
    </div>
  );
}

function ResearchResultContent({
  artist,
  result,
  currentBio,
  proposal,
  activeTab,
  onTabChange,
  onProposalChange,
}: {
  artist: ArtistData;
  result: ResearchResult;
  currentBio: string;
  proposal: string;
  activeTab: ReviewTab;
  onTabChange: (tab: ReviewTab) => void;
  onProposalChange: (proposal: string) => void;
}) {
  const members = getProposalMembers(result);
  const photoUrl = artistPhotoApiUrl({
    artistId: artist.id,
    artistSlug: artist.slug,
    artistName: artist.name,
  });
  const meta = [
    ...(artist.formed ? [`Since ${artist.formed}`] : []),
    ...(artist.country
      ? [artist.area ? `${artist.area}, ${artist.country}` : artist.country]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
        <span>
          Current library bio:{" "}
          {currentBio.trim()
            ? `${currentBio.trim().length} characters`
            : "empty"}
        </span>
        <span>Model: {result.model || "configured provider"}</span>
      </div>
      <ReviewSummary result={result} />
      <ReviewTabs activeTab={activeTab} onChange={onTabChange} />

      {activeTab === "preview" ? (
        <div
          data-testid="artist-bio-preview"
          className="overflow-hidden rounded-xl border border-border-quiet bg-surface-canvas/20"
        >
          <ArtistBioProfile
            artistName={artist.name}
            photoUrl={photoUrl}
            meta={meta}
            genres={artist.genre_profile ?? []}
            bio={proposal}
            bioExpanded
            members={members}
            libraryStats={{
              albums: artist.albums.length,
              tracks: artist.total_tracks ?? 0,
              sizeMb: artist.total_size_mb ?? 0,
            }}
            scrollableBody={false}
          />
        </div>
      ) : null}

      {activeTab === "review" ? <ReviewChanges result={result} /> : null}

      {activeTab === "edit" ? (
        <div className="space-y-4">
          <label
            htmlFor="artist-bio-proposal"
            className="crate-form-field text-sm"
          >
            <span
              data-slot="form-field-label"
              className="font-medium text-text-secondary-strong"
            >
              Proposed biography
            </span>
            <Textarea
              id="artist-bio-proposal"
              value={proposal}
              onChange={(event) => onProposalChange(event.target.value)}
              rows={14}
              className="min-h-[20rem] max-h-[60dvh] resize-y leading-relaxed"
            />
          </label>
          <p className="text-xs text-text-muted">
            Paragraph breaks are preserved. Members are shown in the Listen
            preview and are not changed by Apply biography.
          </p>
          <ReviewNotes result={result} />
        </div>
      ) : null}

      {activeTab === "sources" ? (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-text-secondary-strong">
              Evidence used
            </p>
            <ResearchSourceList sources={result.sources ?? []} />
          </div>
          <ReviewNotes result={result} />
          <p className="text-xs text-text-muted">
            Existing biography was supplied as context only; claims should be
            checked against the linked sources.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ResearchDialogBody({
  artist,
  artistName,
  currentBio,
  loading,
  error,
  result,
  proposal,
  activeTab,
  onTabChange,
  onProposalChange,
  onRetry,
}: {
  artist: ArtistData;
  artistName: string;
  currentBio: string;
  loading: boolean;
  error: string | null;
  result: ResearchResult | null;
  proposal: string;
  activeTab: ReviewTab;
  onTabChange: (tab: ReviewTab) => void;
  onProposalChange: (proposal: string) => void;
  onRetry: () => void;
}) {
  return (
    <div
      data-testid="artist-bio-research-body"
      className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1"
    >
      {loading ? (
        <div
          aria-live="polite"
          className="flex items-center gap-3 rounded-lg border border-accent-action/20 bg-accent-action/5 p-5 text-sm text-text-secondary-strong"
        >
          <Loader2
            data-admin-ux="bio-research-loading"
            className="animate-spin text-accent-action"
            size={18}
          />
          Searching MusicBrainz, Wikipedia, Last.fm and official pages, then
          consolidating evidence…
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-state-warning/25 bg-state-warning/5 p-4 text-sm text-state-warning-text"
        >
          <div className="space-y-2">
            <p>{error}</p>
            <Button size="sm" variant="outline" onClick={onRetry}>
              {" "}
              Retry research
            </Button>
          </div>
        </div>
      ) : null}
      {result ? (
        <ResearchResultContent
          artist={artist}
          result={result}
          currentBio={currentBio}
          proposal={proposal}
          activeTab={activeTab}
          onTabChange={onTabChange}
          onProposalChange={onProposalChange}
        />
      ) : null}
      {!loading && !result && !error ? (
        <p className="text-sm text-text-muted">
          Preparing research for {artistName}…
        </p>
      ) : null}
    </div>
  );
}

export function ArtistBioResearchDialog({
  open,
  onOpenChange,
  artist,
  currentBio,
  onApply,
}: ArtistBioResearchDialogProps) {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [proposal, setProposal] = useState("");
  const [activeTab, setActiveTab] = useState<ReviewTab>("preview");

  async function runResearch() {
    setResult(null);
    setProposal("");
    setActiveTab("preview");
    setLoading(true);
    setError(null);
    try {
      const endpoint = artistActionApiPath(
        { artistId: artist.id, artistEntityUid: artist.entity_uid },
        "bio/research",
      );
      if (!endpoint) throw new Error("Artist reference missing");
      const queued = await api<{ task_id: string }>(endpoint, "POST", {
        language: "English",
      });
      const task = await waitForTask(queued.task_id, 10 * 60 * 1000);
      if (task.status !== "completed" || !task.result) {
        throw new Error(task.error || "Research task failed");
      }
      const nextResult = normalizeResearchResult(
        task.result as unknown as ResearchResult,
        currentBio,
      );
      setResult(nextResult);
      setProposal(getProposalText(nextResult));
    } catch (nextError) {
      if (nextError instanceof DOMException && nextError.name === "AbortError")
        return;
      const message =
        nextError instanceof Error ? nextError.message : "Research failed";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  async function applyProposal() {
    const value = proposal.trim();
    if (!value) return;
    setApplying(true);
    try {
      await onApply(value);
      toast.success("Biography saved");
      onOpenChange(false);
    } catch (nextError) {
      toast.error(
        nextError instanceof Error
          ? nextError.message
          : "Failed to apply biography",
      );
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!applying) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="flex h-[min(92dvh,960px)] w-[min(92vw,72rem)] max-h-[min(92dvh,960px)] !max-w-5xl flex-col overflow-hidden"
        onOpenAutoFocus={() => void runResearch()}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle className="font-display">
            Research biography with AI
          </DialogTitle>
          <DialogDescription>
            Internet sources are collected and consolidated into an editable
            proposal for {artist.name}. Apply biography saves the reviewed text
            to the library. Other metadata edits remain in the editor until
            saved.
          </DialogDescription>
        </DialogHeader>
        <ResearchDialogBody
          artist={artist}
          artistName={artist.name}
          currentBio={currentBio}
          loading={loading}
          error={error}
          result={result}
          proposal={proposal}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onProposalChange={setProposal}
          onRetry={() => void runResearch()}
        />
        <DialogFooter className="shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={applying}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void applyProposal()}
            disabled={!result || !proposal.trim() || applying}
          >
            {applying ? (
              <Loader2
                data-admin-ux="bio-apply-loading"
                size={14}
                className="mr-2 animate-spin"
              />
            ) : null}
            Apply biography
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
