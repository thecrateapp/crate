import { useId, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, ExternalLink, TriangleAlert } from "lucide-react";

import { Button } from "@crate/ui/shadcn/button";

import { OpsPanel } from "@/components/admin/ops-surfaces";
import { RelativeTime } from "@/components/admin/RelativeTime";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { StructuredValue } from "@/components/admin/StructuredValue";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";
import { ChangeList } from "@/components/agents/plan/ChangeList";
import { DecisionBar } from "@/components/agents/plan/DecisionBar";
import { EditorialChanges } from "@/components/agents/plan/EditorialChanges";
import { ImpactSummary } from "@/components/agents/plan/ImpactSummary";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { useNow } from "@/hooks/use-now";
import type { AgentPlan } from "@/lib/agent-integrations";
import {
  apiErrorText,
  planStateView,
  planTitle,
  requesterText,
  reversibilityText,
  riskView,
} from "@/lib/agent-plan-presentation";
import {
  isRecord,
  operationCapabilities,
  planIsComplete,
  targetIdentity,
} from "@/lib/agent-plan-review";
import {
  editorialView,
  impactView,
  planChangeViews,
  planTargetNamer,
  redactTechnical,
  technicalItems,
  type TechnicalItem,
} from "@/lib/agent-plan-technical";

const base = "/api/admin/agent-plans";

function sourceItems(sources: Record<string, unknown> | undefined) {
  const items: TechnicalItem[] = [];
  const add = (path: string, value: unknown) => {
    const label = `Source: ${path}`;
    if (value === null || value === undefined) {
      items.push({ label, value: null });
    } else if (typeof value === "string" || typeof value === "number") {
      items.push({ label, value });
    } else if (typeof value === "boolean") {
      items.push({ label, value: value ? "Yes" : "No" });
    } else if (Array.isArray(value)) {
      if (value.length === 0) items.push({ label, value: "None" });
      value.forEach((entry, index) => add(`${path} ${index + 1}`, entry));
    } else if (isRecord(value)) {
      const entries = Object.entries(value);
      if (entries.length === 0) items.push({ label, value: "None" });
      entries.forEach(([key, entry]) => add(`${path} › ${key}`, entry));
    }
  };
  Object.entries(sources ?? {}).forEach(([key, value]) => add(key, value));
  return items;
}

/** Every identifier of the plan; the only place hashes and ids are shown. */
function planTechnicalItems(item: AgentPlan): TechnicalItem[] {
  const nameOf = planTargetNamer(item.targets);
  const context = item.authorization_context ?? {};
  const items: TechnicalItem[] = [
    { label: "Plan ID", value: item.plan_id },
    { label: "Plan version", value: item.plan_version },
    { label: "Content hash", value: item.content_hash },
    { label: "Authorization hash", value: item.authorization_context_hash },
    { label: "Policy revision", value: item.policy_revision },
    { label: "Job ID", value: item.job_id ?? null },
    ...(context.client_id
      ? [{ label: "Client ID", value: context.client_id }]
      : []),
    ...(context.authorization_id
      ? [{ label: "Authorization ID", value: context.authorization_id }]
      : []),
    ...sourceItems(item.source_versions),
    ...item.targets.map((target) => ({
      label: `Target: ${nameOf(target)}`,
      value: targetIdentity(target),
    })),
    ...impactView(item.impact).technical,
    ...planChangeViews(item).flatMap((view) => view.technical),
    ...(item.operation === "editorial_change"
      ? editorialView(item).technical
      : []),
    ...technicalItems(
      "Conflicts",
      redactTechnical(item.conflicts ?? [], []).hidden,
    ),
  ];
  // TechnicalDetails keys rows by label, so repeated labels get a suffix.
  const seen = new Map<string, number>();
  return items.map((entry) => {
    const count = (seen.get(entry.label) ?? 0) + 1;
    seen.set(entry.label, count);
    return count === 1
      ? entry
      : { ...entry, label: `${entry.label} (${count})` };
  });
}

export function AgentPlanDetail() {
  const { planId } = useParams();
  // Keyed by plan so the reviewed checkbox and any conflict reset on navigation.
  return <PlanDetail key={planId ?? ""} planId={planId} />;
}

function PlanDetail({ planId }: { planId?: string }) {
  const { hasCapability } = useAuth();
  const canReview =
    hasCapability("agents.plans.review") &&
    Object.values(operationCapabilities).some(hasCapability);
  const plan = useApi<AgentPlan>(
    planId && canReview ? `${base}/${encodeURIComponent(planId)}` : null,
  );
  // One clock for the header and the decision bar; `lapsedAt` records a
  // click that found the plan expired between ticks.
  const tick = useNow(15_000);
  const [lapsedAt, setLapsedAt] = useState<number | null>(null);
  const now = Math.max(tick, lapsedAt ?? 0);
  const changesHeadingId = useId();
  const reversibilityHeadingId = useId();
  const conflictsHeadingId = useId();

  if (!canReview)
    return (
      <p className="text-sm text-white/60">
        You do not have permission to review these plans.
      </p>
    );

  const item = plan.data;
  const errorText = plan.error
    ? apiErrorText(plan.error, "The plan could not be loaded.")
    : null;

  if (!item)
    return (
      <div className="space-y-3">
        {plan.loading ? (
          <p role="status" className="text-sm text-white/55">
            Loading plan…
          </p>
        ) : null}
        {errorText ? (
          <p role="alert" className="text-sm text-red-300">
            {errorText}
          </p>
        ) : null}
        <BackToApprovals />
      </div>
    );

  const domainCapability = operationCapabilities[item.operation];
  const canDecide =
    hasCapability("agents.plans.approve") &&
    !!domainCapability &&
    hasCapability(domainCapability);
  const canApprove = canDecide && item.executable !== false;
  const complete = planIsComplete(item);
  const expiry = new Date(item.expires_at).getTime();
  const expired = !Number.isFinite(expiry) || expiry <= now;
  const awaiting = item.state === "awaiting_approval";
  const state = planStateView(item.state, expired);
  const risk = riskView(item.risk);
  const requester = requesterText(item);
  const conflicts = Array.isArray(item.conflicts) ? item.conflicts : [];

  return (
    <div className="space-y-5 pb-8">
      <OpsPanel
        title={planTitle(item)}
        action={
          <>
            <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
            <StatusBadge tone={risk.tone}>{risk.label}</StatusBadge>
          </>
        }
      >
        <div className="space-y-6">
          <div className="space-y-1 text-sm">
            <p className="text-white/70">
              Requested by {item.integration_name ?? "Unknown connection"}
              {item.created_at ? (
                <>
                  {" · "}
                  <RelativeTime value={item.created_at} now={now} />
                </>
              ) : null}
            </p>
            {requester ? <p className="text-white/55">{requester}</p> : null}
          </div>
          {errorText ? (
            <p role="alert" className="text-sm text-red-300">
              {errorText}
            </p>
          ) : null}
          <ImpactSummary impact={item.impact} />
          <section aria-labelledby={changesHeadingId} className="space-y-2">
            <h3
              id={changesHeadingId}
              className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40"
            >
              Changes
            </h3>
            <ChangeList plan={item} />
          </section>
          {item.operation === "editorial_change" ? (
            <EditorialChanges plan={item} />
          ) : null}
          {item.executable === false ? (
            <p
              role="alert"
              className="flex items-start gap-2 text-sm text-amber-100"
            >
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              This plan contains manual or diagnostic items and cannot be
              executed.
            </p>
          ) : null}
          {conflicts.length > 0 ? (
            <section aria-labelledby={conflictsHeadingId} className="space-y-2">
              <h3
                id={conflictsHeadingId}
                className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40"
              >
                Conflicts
              </h3>
              <div className="text-sm text-white/80">
                <StructuredValue value={redactTechnical(conflicts).visible} />
              </div>
            </section>
          ) : null}
          <section
            aria-labelledby={reversibilityHeadingId}
            className="space-y-1"
          >
            <h3
              id={reversibilityHeadingId}
              className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40"
            >
              Reversibility
            </h3>
            <p className="text-sm text-white/70">
              {reversibilityText(item.reversibility)}
            </p>
          </section>
          <TechnicalDetails items={planTechnicalItems(item)} />
        </div>
      </OpsPanel>
      {awaiting && !canDecide && !complete ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-red-200">
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          The complete change list is not available. This plan cannot be
          approved.
        </p>
      ) : null}
      {item.state === "ready" && !expired ? (
        <p className="text-sm text-white/60">
          Already allowed by this connection&apos;s policy. The agent can apply
          it without approval.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <BackToApprovals />
        {item.job_id ? (
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/tasks?task=${encodeURIComponent(item.job_id)}`}>
              <ExternalLink aria-hidden="true" />
              View execution
            </Link>
          </Button>
        ) : null}
      </div>
      {awaiting && canDecide ? (
        <DecisionBar
          plan={item}
          canDecide={canDecide}
          canApprove={canApprove}
          complete={complete}
          now={now}
          onLapsed={setLapsedAt}
          onDecided={plan.refetch}
          onReload={plan.refetch}
        />
      ) : null}
    </div>
  );
}

function BackToApprovals() {
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link to="/agents/approvals">
        <ArrowLeft aria-hidden="true" />
        Back to approvals
      </Link>
    </Button>
  );
}
