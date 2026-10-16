import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@crate/ui/shadcn/button";
import { Badge } from "@crate/ui/shadcn/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@crate/ui/shadcn/card";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import type {
  AgentCollection,
  AgentPlan,
  AgentPlanSummary,
} from "@/lib/agent-integrations";

const base = "/api/admin/agent-plans";
const operationCapabilities: Record<string, string> = {
  repair_photo_flag: "library.repair.run",
  health_check: "library.repair.run",
  quality_check: "library.repair.run",
  repairs: "library.repair.run",
  metadata_update: "library.metadata.write",
  enrichment: "library.metadata.write",
  analysis: "library.metadata.write",
  library_sync: "library.metadata.write",
  metadata_export: "library.metadata.write",
  metadata_rehydrate: "library.metadata.write",
};
const targetIdentity = (target: AgentPlan["targets"][number]) =>
  target.entity_uid ??
  target.artist_uid ??
  (target.entity_type === "library" && target.scope === "global"
    ? "library:global"
    : null);
const valueText = (value: unknown) => JSON.stringify(value, null, 2) ?? "—";

export function AgentPlanReview() {
  const { planId } = useParams();
  return <PlanReviewPage key={planId ?? "list"} planId={planId} />;
}

function PlanReviewPage({ planId }: { planId?: string }) {
  const { hasCapability } = useAuth();
  const canReview =
    hasCapability("agents.plans.review") &&
    Object.values(operationCapabilities).some(hasCapability);
  const [cursor, setCursor] = useState<string | null>(null);
  const list = useApi<AgentCollection<AgentPlanSummary>>(
    !planId && canReview
      ? `${base}?limit=20${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
        }`
      : null,
  );
  const plan = useApi<AgentPlan>(
    planId && canReview ? `${base}/${encodeURIComponent(planId)}` : null,
  );
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [reviewedIdentity, setReviewedIdentity] = useState<string | null>(null);
  const item = plan.data;
  const domainCapability = item
    ? operationCapabilities[item.operation]
    : undefined;
  const canDecide =
    hasCapability("agents.plans.approve") &&
    !!domainCapability &&
    hasCapability(domainCapability);
  const canApprove = canDecide && item?.executable !== false;
  const expiry = item ? new Date(item.expires_at).getTime() : Number.NaN;
  const expired = !Number.isFinite(expiry) || expiry <= Date.now();
  const reviewIdentity = item
    ? [
        item.plan_id,
        item.plan_version,
        item.content_hash,
        item.authorization_context_hash,
        item.policy_revision,
      ].join("/")
    : null;
  const reviewed =
    reviewIdentity !== null && reviewedIdentity === reviewIdentity;
  const identities = item?.targets.map(targetIdentity) ?? [];
  const complete =
    !!item &&
    !item.truncated &&
    item.target_count > 0 &&
    item.returned_count === item.target_count &&
    item.targets.length === item.target_count &&
    identities.every(Boolean) &&
    new Set(identities).size === item.target_count &&
    item.changes.length > 0 &&
    item.changes.every((change) => {
      const uid = change.entity_uid ?? change.artist_uid;
      if (typeof uid === "string") return identities.includes(uid);
      if (Array.isArray(change.targets) && change.targets.length > 0)
        return change.targets.every(
          (target) =>
            target &&
            typeof target === "object" &&
            identities.includes(targetIdentity(target)),
        );
      return change.scope === "global" && identities.includes("library:global");
    });

  async function decide(decision: "approve" | "reject") {
    if (
      !item ||
      busy ||
      !canDecide ||
      (decision === "approve" && !canApprove) ||
      !complete ||
      expired ||
      conflict ||
      !reviewed
    )
      return;
    setBusy(true);
    try {
      await api(
        `${base}/${encodeURIComponent(item.plan_id)}/${decision}`,
        "POST",
        {
          plan_version: item.plan_version,
          content_hash: item.content_hash,
          policy_revision: item.policy_revision,
          authorization_context_hash: item.authorization_context_hash,
        },
      );
      setReviewedIdentity(null);
      plan.refetch();
      toast.success(decision === "approve" ? "Plan approved" : "Plan rejected");
    } catch (error) {
      setConflict(
        error instanceof Error
          ? error.message
          : "The plan changed. Reload and review it again.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!canReview)
    return (
      <p className="p-6 text-muted-foreground">
        You do not have permission to review these plans.
      </p>
    );
  return (
    <div className="space-y-5 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Agent plan review</h1>
        <p className="text-sm text-muted-foreground">
          Review the exact change before granting approval.
        </p>
      </header>
      {list.loading || plan.loading ? (
        <p role="status">Loading plans…</p>
      ) : null}
      {list.error || plan.error ? (
        <p role="alert" className="text-destructive">
          {list.error || plan.error}
        </p>
      ) : null}
      {!planId ? (
        <>
          <div className="grid gap-3">
            {list.data?.items.map((entry) => (
              <Card key={entry.plan_id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <div>
                    <Badge variant="secondary">
                      {entry.state.replace(/_/g, " ")}
                    </Badge>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Expires {new Date(entry.expires_at).toLocaleString()}
                    </p>
                  </div>
                  <Button asChild variant="outline">
                    <Link
                      to={`/agent-plans/${encodeURIComponent(entry.plan_id)}`}
                    >
                      Review plan
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
          {list.data?.items.length === 0 ? (
            <p className="text-muted-foreground">No agent plans yet.</p>
          ) : null}
          {list.data?.next_cursor ? (
            <Button
              variant="outline"
              onClick={() => setCursor(list.data!.next_cursor!)}
            >
              Next plans
            </Button>
          ) : null}
          {cursor ? (
            <Button variant="ghost" onClick={() => setCursor(null)}>
              First page
            </Button>
          ) : null}
        </>
      ) : null}
      {item ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-3 text-base">
                {item.operation === "repair_photo_flag"
                  ? "Update artist photo flag"
                  : item.operation.replace(/_/g, " ")}
                <Badge variant="secondary">
                  {item.state.replace(/_/g, " ")}
                </Badge>
                <Badge variant="outline">{item.risk} risk</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p>
                {item.target_count} targets · Expires{" "}
                {new Date(item.expires_at).toLocaleString()}
              </p>
              <p className="text-sm text-muted-foreground">
                Integration {item.principal_id}
                {item.authorization_context.actor_user_id
                  ? ` · Delegated by user ${item.authorization_context.actor_user_id}`
                  : " · Service integration"}
                {item.authorization_context.client_id
                  ? ` · Client ${item.authorization_context.client_id}`
                  : ""}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">
                    Complete proposed changes
                  </caption>
                  <thead>
                    <tr className="border-b border-border">
                      <th className="py-2">Target</th>
                      <th>Before</th>
                      <th>After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.changes.map((change, index) => {
                      const uid = String(
                        change.entity_uid ??
                          change.artist_uid ??
                          "library:global",
                      );
                      const target = item.targets.find(
                        (entry) => targetIdentity(entry) === uid,
                      );
                      const legacy = item.operation === "repair_photo_flag";
                      return (
                        <tr
                          key={`${uid}/${index}`}
                          className="border-b border-border"
                        >
                          <td className="py-3">
                            <p>{target?.name ?? uid}</p>
                            <code className="text-xs text-muted-foreground">
                              {uid}
                            </code>
                            <p>
                              {String(
                                change.field ??
                                  change.action ??
                                  change.pipeline ??
                                  "operation",
                              )}
                            </p>
                          </td>
                          <td>
                            <pre className="whitespace-pre-wrap break-words">
                              {legacy
                                ? change.before
                                  ? "Photo present"
                                  : "No photo"
                                : valueText(change.before)}
                            </pre>
                          </td>
                          <td>
                            <pre className="whitespace-pre-wrap break-words">
                              {legacy
                                ? change.after
                                  ? "Photo present"
                                  : "No photo"
                                : valueText(
                                    Object.prototype.hasOwnProperty.call(
                                      change,
                                      "after",
                                    )
                                      ? change.after
                                      : change,
                                  )}
                            </pre>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {item.operation === "repair_photo_flag" ? (
                <p className="text-sm">
                  Updates the database flag. Image files remain intact. Does not
                  send notifications.
                </p>
              ) : null}
              <details open>
                <summary>Complete targets, effects and source versions</summary>
                <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-words text-xs">
                  {valueText({
                    targets: item.targets,
                    impact: item.impact,
                    source_versions: item.source_versions,
                    conflicts: item.conflicts,
                  })}
                </pre>
              </details>
              <p className="text-sm text-muted-foreground">
                {item.reversibility}
              </p>
              <p className="text-sm text-muted-foreground">
                Policy revision {item.policy_revision}
              </p>
              {item.executable === false ? (
                <p role="alert">
                  This plan contains manual or diagnostic items and cannot be
                  executed.
                </p>
              ) : null}
              {item.job_id ? (
                <Link
                  className="text-sm underline"
                  to={`/tasks?task=${encodeURIComponent(item.job_id)}`}
                >
                  View execution and verification
                </Link>
              ) : null}
            </CardContent>
          </Card>
          {!complete ? (
            <p role="alert" className="text-destructive">
              The complete change list is not available. This plan cannot be
              approved.
            </p>
          ) : null}
          {expired ? (
            <p role="alert" className="text-destructive">
              This plan has expired. Prepare a new plan.
            </p>
          ) : null}
          {conflict ? (
            <div role="alert" className="space-y-2 text-destructive">
              <p>{conflict}</p>
              <Button
                variant="outline"
                onClick={() => {
                  setConflict(null);
                  setReviewedIdentity(null);
                  plan.refetch();
                }}
              >
                Reload plan
              </Button>
            </div>
          ) : null}
          {item.state === "awaiting_approval" && canDecide ? (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(event) =>
                    setReviewedIdentity(
                      event.target.checked ? reviewIdentity : null,
                    )
                  }
                />
                I reviewed all {item.changes.length} proposed changes and their
                effects.
              </label>
              <div className="flex gap-2">
                <Button
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
                  Approve exact plan
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    busy || expired || !complete || !reviewed || !!conflict
                  }
                  onClick={() => void decide("reject")}
                >
                  Reject plan
                </Button>
              </div>
            </div>
          ) : null}
          {item.state === "ready" ? (
            <p className="text-sm text-muted-foreground">
              This bounded change is already permitted by the integration
              policy.
            </p>
          ) : null}
          <Button variant="link" asChild>
            <Link to="/agent-plans">All plans</Link>
          </Button>
        </>
      ) : null}
    </div>
  );
}
