import { useId } from "react";

import { Button } from "@crate/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";

import {
  connectionName,
  formatCount,
  outcomeGroups,
  reasonText,
} from "@/lib/ai-models";

import type {
  Action,
  AssignmentOutcome,
  Connection,
  ModelAssignmentResult,
} from "./types";

const ADJUSTMENT_NOTES: Record<
  AssignmentOutcome["adjustments"][number],
  string
> = {
  reasoning: "Reasoning adjusted to fit its limits",
  image_detail: "Uses standard image detail",
};

interface GroupItem {
  actionId: string;
  label: string;
  note: string | null;
}

function OutcomeGroup({ title, items }: { title: string; items: GroupItem[] }) {
  const headingId = useId();
  if (items.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="text-sm font-semibold text-foreground">
        {title}
      </h3>
      <ul role="list" className="space-y-1 text-sm">
        {items.map((item) => (
          <li key={item.actionId} className="flex flex-wrap gap-x-2">
            <span className="text-foreground">{item.label}</span>
            {item.note ? (
              <span className="text-muted-foreground">{item.note}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function limitsText(connection: Connection): string {
  return `Connection limits start to apply. ${connectionName(connection)}: ${formatCount(
    connection.max_concurrent,
  )} at a time · ${formatCount(connection.daily_calls)} calls and ${formatCount(
    connection.daily_tokens,
  )} tokens per day.`;
}

export function AssignmentDialog({
  open,
  modelId,
  connection,
  result,
  actions,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  modelId: string;
  connection: Connection | null;
  result: ModelAssignmentResult | null;
  actions: Action[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const outcomes = result?.outcomes ?? [];
  const groups = outcomeGroups(outcomes);
  const labelOf = (actionId: string) =>
    actions.find((action) => action.id === actionId)?.label ??
    "Unknown feature";
  const itemsFor = (
    kinds: AssignmentOutcome["outcome"][],
    note: (outcome: AssignmentOutcome) => string | null,
  ): GroupItem[] =>
    outcomes
      .filter((outcome) => kinds.includes(outcome.outcome))
      .map((outcome) => ({
        actionId: outcome.action_id,
        label: labelOf(outcome.action_id),
        note: note(outcome),
      }));
  const reason = (outcome: AssignmentOutcome) =>
    outcome.reason ? reasonText(outcome.reason) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent aria-describedby={undefined} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Use {modelId} for all features?</DialogTitle>
        </DialogHeader>

        {result?.activation && connection ? (
          <div className="space-y-1 rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-100">
            <p>{limitsText(connection)}</p>
            <p>
              Each call reserves its full token allowance until the provider
              reports usage.
            </p>
          </div>
        ) : null}

        <div className="max-h-[50vh] space-y-4 overflow-y-auto">
          <OutcomeGroup
            title={`Will use ${modelId} (${groups.uses})`}
            items={itemsFor(["applied", "unchanged"], (outcome) =>
              outcome.adjustments.length > 0
                ? outcome.adjustments
                    .map((adjustment) => ADJUSTMENT_NOTES[adjustment])
                    .join(" · ")
                : null,
            )}
          />
          <OutcomeGroup
            title={`Keep their current model (${groups.kept})`}
            items={itemsFor(["kept_legacy", "kept_current"], reason)}
          />
          <OutcomeGroup
            title={`Can't be set up (${groups.blocked})`}
            items={itemsFor(["blocked"], reason)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={busy || groups.blocked > 0} onClick={onConfirm}>
            Use for all features
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
