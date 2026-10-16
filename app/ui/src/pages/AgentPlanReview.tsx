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

export function AgentPlanReview() {
  const { planId } = useParams();
  return <PlanReviewPage key={planId ?? "list"} planId={planId} />;
}

function PlanReviewPage({ planId }: { planId?: string }) {
  const { hasCapability } = useAuth();
  const canReview =
    hasCapability("agents.plans.review") && hasCapability("library.repair.run");
  const canApprove =
    hasCapability("agents.plans.approve") &&
    hasCapability("library.repair.run");
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
  const complete =
    !!item &&
    !item.truncated &&
    item.target_count > 0 &&
    item.returned_count === item.target_count &&
    item.targets.length === item.target_count &&
    item.changes.length === item.target_count &&
    new Set(item.targets.map((target) => target.artist_uid)).size ===
      item.target_count &&
    new Set(item.changes.map((change) => change.artist_uid)).size ===
      item.target_count &&
    item.changes.every((change) =>
      item.targets.some((target) => target.artist_uid === change.artist_uid),
    );

  async function decide(decision: "approve" | "reject") {
    if (
      !item ||
      busy ||
      !canApprove ||
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
                Update artist photo flag
                <Badge variant="secondary">
                  {item.state.replace(/_/g, " ")}
                </Badge>
                <Badge variant="outline">{item.risk} risk</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p>
                {item.target_count} artist · Expires{" "}
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
                      <th className="py-2">Artist</th>
                      <th>Before</th>
                      <th>After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.changes.map((change) => (
                      <tr
                        key={change.artist_uid}
                        className="border-b border-border"
                      >
                        <td className="py-3">
                          <p>
                            {item.targets.find(
                              (target) =>
                                target.artist_uid === change.artist_uid,
                            )?.name ?? change.artist_uid}
                          </p>
                          <code className="text-xs text-muted-foreground">
                            {change.artist_uid}
                          </code>
                        </td>
                        <td>{change.before ? "Photo present" : "No photo"}</td>
                        <td>{change.after ? "Photo present" : "No photo"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-sm">
                {item.impact.filesystem_writes
                  ? "Changes library files."
                  : "Updates the database flag. Image files remain intact."}{" "}
                {item.impact.notifications
                  ? "Sends notifications."
                  : "Does not send notifications."}
              </p>
              <p className="text-sm text-muted-foreground">
                {item.reversibility}
              </p>
              <p className="text-sm text-muted-foreground">
                Evidence observed{" "}
                {new Date(item.source_versions.observed_at).toLocaleString()} ·
                Policy revision {item.policy_revision}
              </p>
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
          {item.state === "awaiting_approval" && canApprove ? (
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
                I reviewed all {item.target_count} proposed changes and their
                effects.
              </label>
              <div className="flex gap-2">
                <Button
                  disabled={
                    busy || expired || !complete || !reviewed || !!conflict
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
