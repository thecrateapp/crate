import {
  useEffect,
  useEffectEvent,
  useId,
  useState,
  type FormEvent,
} from "react";
import { PenLine, Plus, ScanText } from "lucide-react";
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
  type SharedShowFields,
  type ShowDraftState,
} from "./show-draft";
import { countLabel } from "./show-import-presentation";
import {
  showPayload,
  type ShowCandidate,
  type ShowDraft,
  type ShowOutcome,
} from "./show-import-types";
import { useShowPlan } from "./use-show-plan";
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
const UNCERTAIN_TEXT =
  "We lost contact before this was confirmed. Retrying continues the same request.";

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
  const [draft, setDraft] = useState<ShowDraftState>(newDraft);
  const [attempted, setAttempted] = useState(false);
  const [notice, setNotice] = useState("");
  // Loading an existing show ends in an edit, so nothing else may start.
  const [linking, setLinking] = useState(false);

  const flow = useShowPlan({
    open,
    onApplied(rows: ShowOutcome[], outcomes: ShowOutcome[]) {
      const saved = savedItemIds(outcomes);
      const remaining = draft.candidates.filter(
        (candidate) => !saved.has(candidate.item_id),
      ).length;
      toast.success(
        `${countLabel(rows.length, "show")} saved${
          remaining ? ` · ${remaining} still to review` : ""
        }`,
      );
      onSaved();
      setDraft((current) => ({ ...current, selected: [] }));
      return remaining ? "editing" : "saved";
    },
  });
  // Manual entry never activates the source: no availability, no probe.
  const source = useShowSource({
    active: allowed && open && mode === "import",
    // A functional update, so an import that finishes later never drops
    // edits made since it started.
    onDraft(imported: ShowDraft) {
      setDraft((current) => mergeImportedDraft(current, imported));
      flow.addOutcomes(Object.values(imported.publication ?? {}));
      flow.invalidate();
    },
  });

  function reset() {
    flow.reset();
    setMode("manual");
    setDraft(newDraft());
    setAttempted(false);
    setNotice("");
  }

  const opened = useEffectEvent(() => {
    if (flow.phase === "saved") reset();
  });
  useEffect(() => {
    if (open) opened();
  }, [open]);

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
          {flow.plan ? (
            <ShowPlanSummary
              plan={flow.plan}
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
          {flow.phase === "saved" ? (
            <p role="status" className="text-sm font-medium">
              {savedCount === 1
                ? "Show saved."
                : `${countLabel(savedCount, "show")} saved.`}
            </p>
          ) : null}
          {flow.changed ? (
            <p role="status" className="text-sm">
              The draft changed. Review again before saving.
            </p>
          ) : null}
          {flow.busy ? (
            <p role="status" className="text-sm">
              {flow.phase === "preparing"
                ? "Checking the selection. Nothing is published yet."
                : "Saving the reviewed selection…"}
            </p>
          ) : null}
          {flow.phase === "uncertain" ? (
            <p role="status" className="text-sm">
              {UNCERTAIN_TEXT}
            </p>
          ) : null}
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
              {selection.length > 1
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
      </SheetContent>
    </Sheet>
  );
}
