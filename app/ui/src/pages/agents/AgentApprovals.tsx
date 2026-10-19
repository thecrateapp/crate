import { useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { Link } from "react-router";

import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Button } from "@crate/ui/shadcn/button";

import { OpsPanel } from "@/components/admin/ops-surfaces";
import { RelativeTime } from "@/components/admin/RelativeTime";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import type {
  AgentCollection,
  AgentPlanListItem,
} from "@/lib/agent-integrations";
import {
  connectionKindLabel,
  planStateView,
  planTitle,
  riskView,
} from "@/lib/agent-plan-presentation";
import { operationCapabilities } from "@/lib/agent-plan-review";

const base = "/api/admin/agent-plans";

type PlanView = "pending" | "history";

const VIEW_ITEMS: { value: PlanView; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "history", label: "History" },
];

export function AgentApprovals() {
  const { hasCapability } = useAuth();
  const canReview = Object.values(operationCapabilities).some(hasCapability);
  const [view, setView] = useState<PlanView>("pending");

  if (!canReview) {
    return (
      <p className="text-sm text-white/60">
        You do not have permission to review these plans.
      </p>
    );
  }

  return (
    <OpsPanel
      icon={ClipboardCheck}
      title="Approvals"
      description="Review agent-proposed changes before they run, or look back at plans that were already decided or expired."
      action={
        <SegmentedControl
          as="radio"
          label="Plan status"
          items={VIEW_ITEMS}
          value={view}
          onValueChange={setView}
        />
      }
    >
      <ApprovalsList key={view} view={view} />
    </OpsPanel>
  );
}

function ApprovalsList({ view }: { view: PlanView }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [items, setItems] = useState<AgentPlanListItem[]>([]);
  const { data, loading, error } = useApi<AgentCollection<AgentPlanListItem>>(
    `${base}?view=${view}&limit=20${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
    }`,
  );

  useEffect(() => {
    if (!data) return;
    setItems((previous) => {
      const next = cursor ? [...previous] : [];
      const seen = new Set(next.map((entry) => entry.plan_id));
      for (const entry of data.items) {
        if (seen.has(entry.plan_id)) continue;
        seen.add(entry.plan_id);
        next.push(entry);
      }
      return next;
    });
    // `cursor` decides replace-vs-append for this page's arrival; it is read,
    // not written, here, and is intentionally part of the dependency list.
  }, [data, cursor]);

  const emptyMessage =
    view === "pending"
      ? "No changes are waiting for approval."
      : "No decided or expired plans yet.";
  const nextCursor = data?.next_cursor ?? null;

  return (
    <div className="space-y-3">
      {loading && items.length === 0 ? (
        <p role="status" className="text-sm text-white/55">
          Loading agent plans…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <p className="text-sm text-white/55">{emptyMessage}</p>
      ) : null}
      {items.length > 0 ? (
        <ul className="space-y-3">
          {items.map((item) => (
            <ApprovalRow key={item.plan_id} item={item} view={view} />
          ))}
        </ul>
      ) : null}
      {nextCursor ? (
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => setCursor(nextCursor)}
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}

function ApprovalRow({
  item,
  view,
}: {
  item: AgentPlanListItem;
  view: PlanView;
}) {
  const title = planTitle({
    operation: item.operation ?? "",
    target_count: item.target_count,
  });
  const state = planStateView(item.state, item.expired);
  const risk = riskView(item.risk);

  return (
    <li>
      <Link
        to={`/agents/approvals/${encodeURIComponent(item.plan_id)}`}
        aria-label={title}
        className="flex flex-col gap-2 rounded-md border border-white/10 bg-white/[0.02] p-4 transition-colors hover:bg-white/5 md:flex-row md:items-center md:justify-between"
      >
        <div className="space-y-1">
          <p className="font-medium text-white">{title}</p>
          <p className="text-sm text-white/55">
            {item.integration_name ?? "Unknown connection"} ·{" "}
            {connectionKindLabel(item.integration_kind)}
          </p>
          <p className="text-sm text-white/45">
            Requested <RelativeTime value={item.created_at} />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
          <StatusBadge tone={risk.tone}>{risk.label}</StatusBadge>
          {view === "pending" ? (
            <span className="text-sm text-white/45">
              Expires <RelativeTime value={item.expires_at} />
            </span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
