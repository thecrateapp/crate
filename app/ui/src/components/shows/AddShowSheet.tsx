import { useId, useRef, useState, type FormEvent } from "react";
import { PenLine, Plus, RotateCcw, ScanText } from "lucide-react";
import { toast } from "sonner";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Button } from "@crate/ui/shadcn/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@crate/ui/shadcn/sheet";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { ShowCandidateFields } from "./ShowCandidateFields";
import { ShowCandidateList } from "./ShowCandidateList";
import { ShowPlanSummary } from "./ShowPlanSummary";
import { ShowSourcePanel } from "./ShowSourcePanel";
import {
  MAX_DRAFT_SHOWS,
  MAX_SELECTED_SHOWS,
  addDate,
  fillDates,
  isBlankCandidate,
  mergeImportedDraft,
  missingFields,
  newDraft,
  removeDate,
  reviewSelection,
  savedItemIds,
  unsavedWithContent,
  type SharedShowFields,
  type ShowDraftState,
} from "./show-draft";
import { UNCERTAIN_TEXT, countLabel } from "./show-import-presentation";
import {
  showPayload,
  type ShowCandidate,
  type ShowDraft,
  type ShowOutcome,
} from "./show-import-types";
import { useResetAfterClose, useShowPlan } from "./use-show-plan";
import { useShowSource } from "./use-show-source";

type Mode = "manual" | "import";

const MODES = [
  {
    value: "manual" as const,
    label: "Enter manually",
    icon: <PenLine aria-hidden="true" />,
  },
  {
    value: "import" as const,
    label: "Import from flyer, text or link",
    icon: <ScanText aria-hidden="true" />,
  },
];

const TOO_MANY_TEXT =
  "Select up to 50 shows per save. The rest stay here for the next batch.";
const MISSING_TEXT = "Fill in the highlighted fields to continue.";
const EXISTING_FAILED_TEXT =
  "Couldn't load the existing show. Keep this draft and try again.";

export function AddShowSheet({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { hasCapability } = useAuth();
  const allowed = hasCapability("curation.shows.write");
  const formId = useId();
  // Everything lives outside SheetContent, so closing the panel keeps the
  // draft, the pending review or save, and the readiness check.
  const [mode, setMode] = useState<Mode>("manual");
  const [draft, setDraftState] = useState<ShowDraftState>(newDraft);
  // Mirrors `draft`, so an import that finishes later merges into the
  // latest rows and can tell whether it added any.
  const draftRef = useRef(draft);
  const [attempted, setAttempted] = useState(false);
  const [notice, setNotice] = useState("");
  // Loading an existing show ends in an edit, so nothing else may start.
  const [linking, setLinking] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  function setDraft(
    next: ShowDraftState | ((current: ShowDraftState) => ShowDraftState),
  ) {
    const value = typeof next === "function" ? next(draftRef.current) : next;
    draftRef.current = value;
    setDraftState(value);
  }

  const flow = useShowPlan({
    open,
    onApplied(rows: ShowOutcome[], outcomes: ShowOutcome[]) {
      const saved = savedItemIds(outcomes);
      const unsavedIds = draft.candidates
        .filter((candidate) => !saved.has(candidate.item_id))
        .map((candidate) => candidate.item_id);
      const remaining = unsavedIds.length;
      toast.success(
        `${countLabel(rows.length, "show")} saved${
          remaining ? ` · ${remaining} still to review` : ""
        }`,
      );
      onSaved();
      // A lone unsaved row is what «Review show» sends, so it shows selected.
      setDraft((current) => ({
        ...current,
        selected: remaining === 1 ? unsavedIds : [],
      }));
      return remaining ? "editing" : "saved";
    },
    // Rows that did save are already in Crate, so the list refreshes.
    onPartlySaved: () => onSaved(),
  });
  // Manual entry never activates the source: no availability, no probe.
  const source = useShowSource({
    active: allowed && open && mode === "import",
    // Merged into the latest rows, so an import that finishes later never
    // drops edits made since it started.
    onDraft(imported: ShowDraft) {
      const published = Object.values(imported.publication ?? {});
      // An import that found nothing changes nothing, so a review stands.
      if (!imported.candidates.length && !published.length) return;
      const savedIds = savedItemIds(flow.outcomes);
      const current = draftRef.current;
      const merged = mergeImportedDraft(current, imported, savedIds);
      flow.addOutcomes(published);
      // Every show read is already in the draft: nothing changed, so a
      // standing review stands too.
      if (imported.candidates.length && merged === current) return false;
      setDraft(merged);
      flow.invalidate();
    },
  });

  function reset() {
    flow.reset();
    source.reset();
    setMode("manual");
    setDraft(newDraft());
    setAttempted(false);
    setNotice("");
    setConfirmingDiscard(false);
  }

  useResetAfterClose(open, flow.phase === "saved", reset);

  const locked = flow.locked || source.busy || linking;
  const saved = savedItemIds(flow.outcomes);
  const outcomeById = new Map(
    flow.outcomes.map((outcome) => [outcome.item_id, outcome]),
  );
  const selection = reviewSelection(draft, saved);
  const single = draft.candidates.length === 1;
  const rowsShown =
    mode === "manual" || !(single && isBlankCandidate(draft.candidates[0]!));
  const showMissing = (candidate: ShowCandidate) =>
    Boolean(candidate.source_draft_id) || attempted;

  function update(change: (current: ShowDraftState) => ShowDraftState) {
    if (locked) return;
    setDraft(change);
    setNotice("");
    flow.invalidate();
  }

  function edit(candidate: ShowCandidate) {
    update((current) => ({
      ...current,
      candidates: current.candidates.map((item) =>
        item.item_id === candidate.item_id ? candidate : item,
      ),
    }));
  }

  function patch(itemId: string, values: Partial<ShowCandidate>) {
    update((current) => ({
      ...current,
      candidates: current.candidates.map((item) =>
        item.item_id === itemId ? { ...item, ...values } : item,
      ),
    }));
  }

  async function linkExisting(itemId: string, showId: number) {
    if (locked) return;
    setLinking(true);
    try {
      const existing = await api<{ id: number; revision: number }>(
        `/api/show-imports/shows/${encodeURIComponent(String(showId))}`,
      );
      patch(itemId, {
        existing_show_id: existing.id,
        expected_revision: existing.revision,
      });
    } catch {
      setNotice(EXISTING_FAILED_TEXT);
    } finally {
      setLinking(false);
    }
  }

  function review(event: FormEvent) {
    event.preventDefault();
    if (locked || !rowsShown || !selection.length) return;
    if (selection.length > MAX_SELECTED_SHOWS) {
      setNotice(TOO_MANY_TEXT);
      return;
    }
    if (selection.some((candidate) => missingFields(candidate).length)) {
      setAttempted(true);
      setNotice(MISSING_TEXT);
      return;
    }
    setNotice("");
    flow.prepare({ candidates: selection.map(showPayload) });
  }

  if (!allowed) return null;

  const savedCount = draft.candidates.filter((candidate) =>
    saved.has(candidate.item_id),
  ).length;
  const planCount = flow.plan?.changes.length ?? 0;
  const plan = flow.plan?.kind === "consolidation" ? null : flow.plan;
  // Rows that hold something are only discarded after a yes; saved rows
  // stay in Crate whatever happens to the draft.
  const discarded = unsavedWithContent(draft, saved).length;
  const sourceHasContent = Boolean(
    source.text.trim() ||
      source.url.trim() ||
      source.images.length ||
      source.storedImages.length,
  );
  // An import whose acceptance was lost keeps its key for «Retry import»;
  // starting over would drop it and could pay for a second extraction.
  const canStartOver =
    !locked &&
    !source.uncertain &&
    flow.phase !== "saved" &&
    (discarded > 0 || draft.candidates.length > 1 || sourceHasContent);
  const status =
    flow.phase === "saved"
      ? savedCount === 1
        ? "Show saved."
        : `${countLabel(savedCount, "show")} saved.`
      : flow.busy
        ? flow.phase === "preparing"
          ? "Checking the selection. Nothing is published yet."
          : "Saving the reviewed selection…"
        : flow.phase === "uncertain"
          ? UNCERTAIN_TEXT
          : flow.changed
            ? "The draft changed. Review again before saving."
            : "";
  const nothingSelected =
    rowsShown && draft.candidates.length > 1 && selection.length === 0;

  function startOver() {
    if (!canStartOver) return;
    if (discarded > 0) setConfirmingDiscard(true);
    else reset();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-2xl"
      >
        <SheetHeader className="pr-14">
          <SheetTitle>Add show</SheetTitle>
          <SheetDescription>
            Drafts are private to you. Nothing is published until you review and
            save.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-4">
          <SegmentedControl
            as="radio"
            label="How to add shows"
            fullWidth
            className="rounded-lg"
            itemClassName="h-auto min-h-9 whitespace-normal rounded-md py-1.5 leading-tight"
            items={MODES.map((item) => ({ ...item, disabled: locked }))}
            value={mode}
            onValueChange={setMode}
          />
          {mode === "import" ? (
            <ShowSourcePanel
              source={source}
              disabled={
                flow.busy ||
                flow.phase === "uncertain" ||
                flow.phase === "saved"
              }
            />
          ) : null}
          <form id={formId} noValidate className="space-y-4" onSubmit={review}>
            {rowsShown ? (
              single ? (
                <ShowCandidateFields
                  candidate={draft.candidates[0]!}
                  index={null}
                  locked={locked}
                  showMissing={showMissing(draft.candidates[0]!)}
                  outcome={outcomeById.get(draft.candidates[0]!.item_id)}
                  onChange={edit}
                />
              ) : (
                <ShowCandidateList
                  draft={draft}
                  outcomes={flow.outcomes}
                  locked={locked}
                  showMissing={showMissing}
                  onChange={edit}
                  onSelect={(ids) =>
                    update((current) => ({ ...current, selected: ids }))
                  }
                  onFill={(values: SharedShowFields, ids: string[]) =>
                    update((current) => fillDates(current, values, ids))
                  }
                  onRemove={(itemId) =>
                    update((current) => removeDate(current, itemId))
                  }
                />
              )
            ) : null}
            {rowsShown ? (
              <Button
                type="button"
                variant="outline"
                disabled={locked || draft.candidates.length >= MAX_DRAFT_SHOWS}
                onClick={() => update(addDate)}
              >
                <Plus aria-hidden="true" />
                Add another date
              </Button>
            ) : null}
          </form>
          {plan ? (
            <ShowPlanSummary
              plan={plan}
              candidates={draft.candidates}
              disabled={locked}
              onUseExisting={(itemId, showId) =>
                void linkExisting(itemId, showId)
              }
              onUseArtist={(itemId, artist) =>
                patch(itemId, {
                  artist_uid: artist.artist_uid,
                  artist_name: artist.name,
                })
              }
            />
          ) : null}
          {/* Always mounted, so a screen reader hears each change. */}
          <p
            role="status"
            className={
              flow.phase === "saved"
                ? "text-sm font-medium empty:sr-only"
                : "text-sm empty:sr-only"
            }
          >
            {status}
          </p>
          {notice ? (
            <p role="alert" className="text-sm text-state-danger-text">
              {notice}
            </p>
          ) : null}
          {flow.error ? (
            <p role="alert" className="text-sm text-state-danger-text">
              {flow.error}
            </p>
          ) : null}
        </div>
        <SheetFooter className="sticky bottom-0 flex-row flex-wrap justify-end gap-2 border-t border-border-quiet bg-modal-surface/95 backdrop-blur">
          {flow.phase === "saved" ? null : (
            <Button
              type="button"
              variant="ghost"
              className="mr-auto"
              disabled={!canStartOver}
              onClick={startOver}
            >
              <RotateCcw aria-hidden="true" />
              Start over
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          {flow.phase === "uncertain" ? (
            <Button type="button" onClick={flow.retry}>
              {flow.pendingKind === "apply" ? "Retry save" : "Retry review"}
            </Button>
          ) : null}
          {flow.phase === "editing" || flow.phase === "reviewed" ? (
            <Button
              type="submit"
              form={formId}
              variant={flow.plan?.executable ? "outline" : "default"}
              disabled={locked || !rowsShown || selection.length === 0}
            >
              {nothingSelected
                ? "Select shows to review"
                : selection.length > 1
                  ? `Review ${selection.length} shows`
                  : "Review show"}
            </Button>
          ) : null}
          {flow.phase === "reviewed" && flow.plan?.executable ? (
            <Button type="button" disabled={locked} onClick={flow.apply}>
              {planCount === 1 ? "Save show" : `Save ${planCount} shows`}
            </Button>
          ) : null}
          {flow.phase === "saved" ? (
            <>
              <Button type="button" variant="outline" onClick={reset}>
                Add another show
              </Button>
              <Button
                type="button"
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
              >
                Done
              </Button>
            </>
          ) : null}
        </SheetFooter>
        <ConfirmDialog
          open={confirmingDiscard}
          onOpenChange={setConfirmingDiscard}
          title={`Discard ${countLabel(discarded, "unsaved show")}?`}
          description="The draft and its source are cleared. Shows you already saved stay in Crate."
          confirmLabel="Discard"
          variant="destructive"
          onConfirm={reset}
        />
      </SheetContent>
    </Sheet>
  );
}
