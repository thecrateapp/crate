import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@crate/ui/shadcn/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@crate/ui/shadcn/sheet";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";
import { PlanApprovalNote } from "./PlanApprovalNote";
import {
  ShowConsolidationEditor,
  emptyConsolidationDraft,
} from "./ShowConsolidationEditor";
import {
  UNCERTAIN_TEXT,
  issueText,
  mergePlanView,
  showLinkPath,
  type MergeShowView,
} from "./show-import-presentation";
import type { ShowConsolidationPlan } from "./show-import-types";
import { useResetAfterClose, useShowPlan } from "./use-show-plan";

function ShowSummary({ show }: { show: MergeShowView }) {
  return (
    <div className="space-y-0.5 rounded-md border border-border p-3 text-sm">
      <p className="font-medium">{show.title}</p>
      <p className="text-xs text-muted-foreground">{show.detail}</p>
      <p className="text-xs text-muted-foreground">{show.people}</p>
    </div>
  );
}

function MergeReview({ plan }: { plan: ShowConsolidationPlan }) {
  const keepId = useId();
  const mergeId = useId();
  const view = mergePlanView(plan);
  const change = plan.changes.find((item) => item.item_id === "consolidation");
  const revisions = change?.after.revisions ?? {};
  return (
    <section
      aria-label="Merge review"
      className="space-y-4 rounded-md border border-border p-4"
    >
      {view.keep ? (
        <div role="group" aria-labelledby={keepId} className="space-y-1.5">
          <h3 id={keepId} className="text-sm font-medium">
            Keep
          </h3>
          <ShowSummary show={view.keep} />
        </div>
      ) : null}
      {view.merge.length ? (
        <div role="group" aria-labelledby={mergeId} className="space-y-1.5">
          <h3 id={mergeId} className="text-sm font-medium">
            Merge into it
          </h3>
          <ul className="space-y-2">
            {view.merge.map((show) => (
              <li key={show.id}>
                <ShowSummary show={show} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="space-y-1 text-sm">
        <p>
          Going lists, reminders and links move to the show you keep. Old show
          links open the kept show.
        </p>
        <p className="font-medium text-state-warning-text">
          Can&apos;t be undone automatically.
        </p>
      </div>
      {plan.issues?.map((issue, index) => (
        <p
          key={`${issue.item_id}-${index}`}
          role="alert"
          className="text-sm text-state-danger-text"
        >
          {issueText(issue, null)}
        </p>
      ))}
      {plan.approval_required ? (
        <PlanApprovalNote planId={plan.plan_id} subject="merge" />
      ) : null}
      <TechnicalDetails
        items={[
          { label: "Plan ID", value: plan.plan_id },
          { label: "Plan version", value: plan.plan_version },
          ...Object.entries(revisions).map(([id, revision]) => ({
            label: `Revision of show ${id}`,
            value: revision,
          })),
        ]}
      />
    </section>
  );
}

export function MergeShowsSheet({
  open,
  onOpenChange,
  onMerged,
  initialIds = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged: () => void;
  /**
   * Shows to load as soon as the panel opens, e.g. a show and its look-alikes
   * from Upcoming. A new array starts a new merge; the same array reopens the
   * merge as it was left.
   */
  initialIds?: readonly number[] | null;
}) {
  const [selection, setSelection] = useState(emptyConsolidationDraft);
  // The prefill already taken, so reopening the panel keeps the merge as it
  // was left instead of loading the shows again.
  const [usedPrefill, setUsedPrefill] = useState<readonly number[] | null>(
    null,
  );
  const flow = useShowPlan({
    open,
    approvalAction: "merge",
    onApplied: () => {
      toast.success("Shows merged");
      onMerged();
      return "saved";
    },
  });

  function reset() {
    flow.reset();
    setSelection(emptyConsolidationDraft());
  }

  useResetAfterClose(open, flow.phase === "saved", reset);
  // Opened over a pending review or merge, the prefill is dropped: the
  // pending request is never replaced.
  useEffect(() => {
    if (open && initialIds && flow.locked) setUsedPrefill(initialIds);
  }, [open]);

  // A pending review or merge is never replaced by a prefill.
  const prefill =
    open && initialIds && initialIds !== usedPrefill && !flow.locked
      ? initialIds
      : null;
  const kept = flow.outcomes.find(
    (outcome) => outcome.item_id === "consolidation",
  );
  const saved = flow.phase === "saved";
  const plan = flow.plan?.kind === "consolidation" ? flow.plan : null;
  const status = saved
    ? "Shows merged."
    : flow.busy
      ? flow.phase === "preparing"
        ? "Checking the merge…"
        : "Merging…"
      : flow.phase === "uncertain"
        ? UNCERTAIN_TEXT
        : flow.changed
          ? "The selection changed. Review again before merging."
          : "";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="pr-14">
          <SheetTitle>Merge duplicate shows</SheetTitle>
          <SheetDescription>
            Use this only when saved shows are the same performance. The show
            you keep gets the others&apos; going list, reminders and links.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-4">
          {saved ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {kept?.show_id ? (
                <a
                  href={showLinkPath(kept.show_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline underline-offset-2"
                >
                  Open the kept show
                </a>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={reset}>
                Merge more
              </Button>
            </div>
          ) : (
            <>
              <ShowConsolidationEditor
                value={selection}
                disabled={flow.locked}
                initialIds={prefill}
                onPrefilled={() => setUsedPrefill(initialIds)}
                onValueChange={(next) => {
                  setSelection(next);
                  flow.invalidate();
                }}
                onReview={(consolidation) => flow.prepare({ consolidation })}
              />
              {plan ? <MergeReview plan={plan} /> : null}
            </>
          )}
          {/* Always mounted, so a screen reader hears each change. */}
          <p
            role="status"
            className={
              saved
                ? "text-sm font-medium empty:sr-only"
                : "text-sm empty:sr-only"
            }
          >
            {status}
          </p>
          {!saved && flow.error ? (
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
              {flow.pendingKind === "apply" ? "Retry merge" : "Retry review"}
            </Button>
          ) : null}
          {flow.phase === "reviewed" && flow.plan?.executable ? (
            <Button type="button" onClick={flow.apply}>
              Merge shows
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
