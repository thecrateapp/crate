import { useId, useState } from "react";
import { Clock, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { Button } from "@crate/ui/shadcn/button";

import { RelativeTime } from "@/components/admin/RelativeTime";
import { useNow } from "@/hooks/use-now";
import { notifyAgentPlansChanged } from "@/hooks/use-pending-approvals";
import type { AgentPlan } from "@/lib/agent-integrations";
import { apiErrorText } from "@/lib/agent-plan-presentation";
import { reviewIdentity } from "@/lib/agent-plan-review";
import { api } from "@/lib/api";

const base = "/api/admin/agent-plans";
const STALE_PLAN_MESSAGE = "The plan changed. Reload and review it again.";

// Sticks to the bottom of the content column; the page adds bottom padding so
// it never hides the last change or the Technical details toggle.
const barClassName =
  "sticky bottom-0 z-10 rounded-t-md border-t border-white/10 bg-panel-surface/95 px-4 py-3 shadow-[0_-18px_40px_rgba(0,0,0,0.25)] backdrop-blur md:px-5";

export function DecisionBar({
  plan,
  canDecide,
  canApprove,
  complete,
  onDecided,
  onReload,
}: {
  plan: AgentPlan;
  canDecide: boolean;
  canApprove: boolean;
  complete: boolean;
  onDecided: () => void;
  onReload: () => void;
}) {
  const now = useNow(15_000);
  const checkboxId = useId();
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [reviewedIdentity, setReviewedIdentity] = useState<string | null>(null);
  // Set when a click finds the plan already expired between clock ticks.
  const [lapsedAt, setLapsedAt] = useState<number | null>(null);

  const effectiveNow = Math.max(now, lapsedAt ?? 0);
  const expiry = new Date(plan.expires_at).getTime();
  const validExpiry = Number.isFinite(expiry);
  const expired = !validExpiry || expiry <= effectiveNow;
  const currentReviewIdentity = reviewIdentity(plan);
  const reviewed = reviewedIdentity === currentReviewIdentity;

  async function decide(decision: "approve" | "reject") {
    if (
      busy ||
      !canDecide ||
      (decision === "approve" && !canApprove) ||
      !complete ||
      expired ||
      conflict ||
      !reviewed
    )
      return;
    const clickedAt = Date.now();
    if (expiry <= clickedAt) {
      setLapsedAt(clickedAt);
      return;
    }
    setBusy(true);
    try {
      await api(
        `${base}/${encodeURIComponent(plan.plan_id)}/${decision}`,
        "POST",
        {
          plan_version: plan.plan_version,
          content_hash: plan.content_hash,
          policy_revision: plan.policy_revision,
          authorization_context_hash: plan.authorization_context_hash,
        },
      );
      setReviewedIdentity(null);
      onDecided();
      notifyAgentPlansChanged();
      toast.success(decision === "approve" ? "Plan approved" : "Plan rejected");
    } catch (error) {
      setConflict(apiErrorText(error, STALE_PLAN_MESSAGE));
    } finally {
      setBusy(false);
    }
  }

  if (expired) {
    return (
      <div className={barClassName}>
        <div role="alert" className="flex items-start gap-2 text-sm">
          <Clock
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-amber-200"
          />
          {validExpiry ? (
            <p className="text-white/80">
              This plan expired{" "}
              <RelativeTime value={plan.expires_at} now={effectiveNow} />. Ask
              the agent to prepare it again.
            </p>
          ) : (
            <p className="text-white/80">
              This plan expired. Ask the agent to prepare it again.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={barClassName}>
      <div className="space-y-3">
        {!complete ? (
          <p
            role="alert"
            className="flex items-start gap-2 text-sm text-red-200"
          >
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            The complete change list is not available. This plan cannot be
            approved.
          </p>
        ) : null}
        {conflict ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 text-sm text-red-200"
          >
            <p className="min-w-0 flex-1 break-words">{conflict}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setConflict(null);
                setReviewedIdentity(null);
                onReload();
              }}
            >
              Reload plan
            </Button>
          </div>
        ) : null}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <Checkbox
              id={checkboxId}
              className="mt-0.5"
              checked={reviewed}
              onCheckedChange={(checked) =>
                setReviewedIdentity(
                  checked === true ? currentReviewIdentity : null,
                )
              }
            />
            <label htmlFor={checkboxId} className="text-sm text-white/80">
              {plan.operation === "editorial_change"
                ? "I reviewed the complete playlist selection, order, rules, exclusions, metadata and effects."
                : `I reviewed all ${plan.changes.length} changes and their effects.`}
            </label>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              disabled={
                busy ||
                !canApprove ||
                expired ||
                !complete ||
                !reviewed ||
                !!conflict
              }
              onClick={() => void decide("approve")}
            >
              Approve
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || expired || !complete || !reviewed || !!conflict}
              onClick={() => void decide("reject")}
            >
              Reject
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
