import { useState } from "react";
import {} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@crate/ui/shadcn/button";

import { OpsPanel } from "@/components/admin/ops-surfaces";
import { useAuth } from "@/contexts/AuthContext";
import {
  assignmentSummary,
  initialDefaultChoice,
  limitedConnections,
  reasonText,
  reasoningLabel,
  reasoningValue,
} from "@/lib/ai-models";

import { reportFailure, writeAI } from "./api";
import { AssignmentDialog } from "./AssignmentDialog";
import { ModelPicker, type ModelChoice } from "./ModelPicker";
import type {
  Action,
  Connection,
  ModelAssignmentResult,
  ReasoningConfig,
  Snapshot,
} from "./types";

interface AssignmentBody {
  connection_id: string;
  model_id: string;
  reasoning: ReasoningConfig;
  expected_revision: number;
  expected_review_fingerprint: string;
}

/** A dry run and the exact identity it reviewed, kept apart from newer snapshots. */
interface Review {
  body: AssignmentBody;
  result: ModelAssignmentResult;
  connections: Connection[];
  actions: Action[];
}

function statusLine(snapshot: Snapshot): { text: string; warning: boolean } {
  const current = snapshot.default_model;
  if (current && !current.available) {
    return {
      text: `The default model is no longer available: ${reasonText(
        current.error_code,
      )}.`,
      warning: true,
    };
  }
  if (current) {
    return {
      text: `Current default: ${current.model_id} · ${reasoningLabel(
        current.reasoning,
      )}`,
      warning: false,
    };
  }
  if (!snapshot.migrated) {
    const legacy = snapshot.legacy_actions[0]?.model_id;
    const uses = legacy
      ? `Crate currently uses ${legacy} from server settings.`
      : "Crate currently uses server settings.";
    return {
      text: `${uses} Choosing a default model moves every feature to AI models settings.`,
      warning: false,
    };
  }
  return {
    text: "No default model is set. Each feature keeps the model it uses now.",
    warning: false,
  };
}

function announce(
  modelId: string,
  result: ModelAssignmentResult,
  actions: Action[],
) {
  toast.success("Default model updated", {
    description: assignmentSummary(modelId, result.outcomes, actions),
  });
}

/** Re-applying the usable default only re-applies features that have their own model. */
function isCurrentDefault(snapshot: Snapshot, body: AssignmentBody): boolean {
  const current = snapshot.default_model;
  return (
    !!current?.available &&
    current.connection_id === body.connection_id &&
    current.model_id === body.model_id &&
    reasoningValue(current.reasoning) === reasoningValue(body.reasoning)
  );
}

/** A feature that is off now takes the model but stays off. */
function staysOffOnApply(result: ModelAssignmentResult): boolean {
  return result.outcomes.some(
    (outcome) => outcome.outcome === "applied" && outcome.enabled === false,
  );
}

export function DefaultModelPanel({
  snapshot,
  refresh,
}: {
  snapshot: Snapshot;
  refresh: () => void;
}) {
  const { hasCapability } = useAuth();
  const canManage = hasCapability("ai.config.manage");
  const [choice, setChoice] = useState<ModelChoice>(() =>
    initialDefaultChoice(snapshot),
  );
  const [review, setReview] = useState<Review | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const status = statusLine(snapshot);
  const connection =
    snapshot.connections.find(
      (candidate) => candidate.id === choice.connectionId,
    ) ?? null;
  const ready = connection !== null && choice.modelId !== "";

  async function submit() {
    if (!connection || !choice.modelId) return;
    // Capture the identity now: a dry run reviews exactly this revision.
    const body: AssignmentBody = {
      connection_id: connection.id,
      model_id: choice.modelId,
      reasoning: choice.reasoning,
      expected_revision: snapshot.revision,
      expected_review_fingerprint: snapshot.review_fingerprint,
    };
    // Review whenever applying may replace a model a feature uses now: before
    // setup, without a usable default, or when some feature has its own model.
    const current = snapshot.default_model;
    const needsReview =
      !snapshot.migrated ||
      !current?.available ||
      current.features.some((feature) => feature.status === "override");
    // Applying never turns a feature on, so check first whether a feature
    // that is off now would take this model; only a dry run can tell.
    const checkSwitches =
      snapshot.bindings.some((binding) => !binding.enabled) &&
      !isCurrentDefault(snapshot, body);
    setBusy(true);
    try {
      if (needsReview || checkSwitches) {
        const result = await writeAI<ModelAssignmentResult>("/default-model", {
          ...body,
          dry_run: true,
        });
        if (needsReview || staysOffOnApply(result)) {
          setReview({
            body,
            result,
            connections: limitedConnections(
              snapshot,
              connection,
              result.outcomes,
            ),
            actions: snapshot.actions,
          });
          setDialogOpen(true);
          return;
        }
      }
      const result = await writeAI<ModelAssignmentResult>("/default-model", {
        ...body,
        dry_run: false,
      });
      announce(body.model_id, result, snapshot.actions);
      refresh();
    } catch (error) {
      reportFailure(error);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!review) return;
    setBusy(true);
    try {
      const result = await writeAI<ModelAssignmentResult>("/default-model", {
        ...review.body,
        dry_run: false,
      });
      announce(review.body.model_id, result, review.actions);
    } catch (error) {
      reportFailure(error);
    } finally {
      setBusy(false);
      setDialogOpen(false);
      refresh();
    }
  }

  return (
    <OpsPanel
      title="Default model"
      description="Every feature uses this model unless you choose a different one for it."
    >
      <div className="space-y-4">
        <p
          className={
            status.warning ? "text-sm text-amber-100" : "text-sm text-white/70"
          }
        >
          {status.text}
        </p>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-3">
            <ModelPicker
              snapshot={snapshot}
              value={choice}
              onChange={(next) => setChoice(next)}
              disabled={busy}
            />
            <Button disabled={!ready || busy} onClick={() => void submit()}>
              Use for all features
            </Button>
          </div>
        ) : null}
      </div>
      {review ? (
        <AssignmentDialog
          open={dialogOpen}
          modelId={review.body.model_id}
          connections={review.connections}
          result={review.result}
          actions={review.actions}
          busy={busy}
          onConfirm={() => void confirm()}
          onCancel={() => setDialogOpen(false)}
        />
      ) : null}
    </OpsPanel>
  );
}
