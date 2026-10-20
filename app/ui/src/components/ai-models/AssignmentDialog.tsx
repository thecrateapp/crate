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

function OutcomeGroup({
  title,
  items,
  hint,
}: {
  title: string;
  items: GroupItem[];
  hint?: string;
}) {
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
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </section>
  );
}

function limitsText(connection: Connection): string {
  return `${connectionName(connection)}: ${formatCount(
    connection.max_concurrent,
  )} at a time · ${formatCount(connection.daily_calls)} calls and ${formatCount(
    connection.daily_tokens,
  )} tokens per day.`;
}

export function AssignmentDialog({
  open,
  modelId,
  connections,
  result,
  actions,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  modelId: string;
  /** Every connection whose limits start to apply if this activates. */
  connections: Connection[];
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
  // Turned-off features have their own group; these keep an existing switch off.
  const staysOff = outcomes.filter(
    (outcome) => outcome.enabled === false && outcome.outcome !== "turned_off",
  );

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

        {result?.activation && connections.length > 0 ? (
          <div className="space-y-1 rounded-md border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-100">
            <p>Connection limits start to apply.</p>
            <ul role="list" className="space-y-1">
              {connections.map((connection) => (
                <li key={connection.persistent_id ?? connection.id}>
                  {limitsText(connection)}
                </li>
              ))}
            </ul>
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
            title={`Will be turned off (${groups.turnedOff})`}
            items={itemsFor(["turned_off"], reason)}
            hint="You can turn them on later with a model that supports them."
          />
          <OutcomeGroup
            title={`Can't be set up (${groups.blocked})`}
            items={itemsFor(["blocked"], reason)}
          />
          {staysOff.length > 0 ? (
            <div className="space-y-1 text-sm text-muted-foreground">
              {staysOff.map((outcome) => (
                <p key={outcome.action_id}>
                  {labelOf(outcome.action_id)} stays off.
                </p>
              ))}
            </div>
          ) : null}
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
