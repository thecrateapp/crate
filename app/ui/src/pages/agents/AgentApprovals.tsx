import { useEffect, useId, useRef, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { Link } from "react-router";

import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Button } from "@crate/ui/shadcn/button";

import { OpsPanel } from "@/components/admin/ops-surfaces";
import { RelativeTime } from "@/components/admin/RelativeTime";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { useNow } from "@/hooks/use-now";
import type {
  AgentCollection,
  AgentPlanListItem,
} from "@/lib/agent-integrations";
import {
  apiErrorText,
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
  // useApi keeps `loading` false after the first page, so the next page's
  // request is tracked here.
  const [loadingMore, setLoadingMore] = useState(false);
  // Rows re-check expiry on this clock, so a plan that lapses while the
  // list is open reads «Expired» even though the snapshot said otherwise.
  const now = useNow(15_000);
  const handled = useRef<AgentCollection<AgentPlanListItem> | null>(null);
  const { data, loading, error, refetch } = useApi<
    AgentCollection<AgentPlanListItem>
  >(
    `${base}?view=${view}&limit=20${
      cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
    }`,
  );

  useEffect(() => {
    // A cursor change alone re-runs this effect with the previous page; only
    // a newly arrived page is merged.
    if (!data || data === handled.current) return;
    handled.current = data;
    setLoadingMore(false);
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

  useEffect(() => {
    if (error) setLoadingMore(false);
  }, [error]);

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
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-red-300">
            {apiErrorText(error, "The plans could not be loaded.")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (cursor) setLoadingMore(true);
              refetch();
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <p className="text-sm text-white/55">{emptyMessage}</p>
      ) : null}
      {items.length > 0 ? (
        <ul className="space-y-3">
          {items.map((item) => (
            <ApprovalRow key={item.plan_id} item={item} view={view} now={now} />
          ))}
        </ul>
      ) : null}
      {nextCursor && !error ? (
        <Button
          variant="outline"
          disabled={loading || loadingMore}
          onClick={() => {
            setLoadingMore(true);
            setCursor(nextCursor);
          }}
        >
          {loadingMore ? "Loading more…" : "Load more"}
        </Button>
      ) : null}
    </div>
  );
}

function ApprovalRow({
  item,
  view,
  now,
}: {
  item: AgentPlanListItem;
  view: PlanView;
  now: number;
}) {
  const titleId = useId();
  const detailsId = useId();
  const statusId = useId();
  const title = planTitle({
    operation: item.operation ?? "",
    target_count: item.target_count,
  });
  const expiry = Date.parse(item.expires_at);
  const expired = item.expired || !Number.isFinite(expiry) || expiry <= now;
  const state = planStateView(item.state, expired);
  const risk = riskView(item.risk);

  return (
    <li>
      <Link
        to={`/agents/approvals/${encodeURIComponent(item.plan_id)}`}
        aria-labelledby={titleId}
        aria-describedby={`${detailsId} ${statusId}`}
        className="flex flex-col gap-2 rounded-md border border-white/10 bg-white/[0.02] p-4 transition-colors hover:bg-white/5 md:flex-row md:items-center md:justify-between"
      >
        <div className="space-y-1">
          <p id={titleId} className="font-medium text-white">
            {title}
          </p>
          <div id={detailsId} className="space-y-1">
            <p className="text-sm text-white/55">
              {item.integration_name ?? "Unknown connection"} ·{" "}
              {connectionKindLabel(item.integration_kind)}
            </p>
            <p className="text-sm text-white/45">
              Requested <RelativeTime value={item.created_at} now={now} />
            </p>
          </div>
        </div>
        <div id={statusId} className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
          <StatusBadge tone={risk.tone}>{risk.label}</StatusBadge>
          {view === "pending" ? (
            <span className="text-sm text-white/45">
              Expires <RelativeTime value={item.expires_at} now={now} />
            </span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
