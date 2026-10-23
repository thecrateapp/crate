import { Navigate, NavLink, Outlet, useParams } from "react-router";

import { OpsPageHero } from "@/components/admin/ops-surfaces";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import { usePendingApprovals } from "@/hooks/use-pending-approvals";
import { cn } from "@/lib/utils";

const AGENTS_APPROVALS = ["agents.plans.review"] as const;
const AGENTS_CONNECTIONS = ["agents.integrations.manage"] as const;

function sectionLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    "inline-flex min-h-11 items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
    isActive
      ? "border-border-quiet bg-card text-text-primary"
      : "border-transparent bg-transparent text-text-muted hover:bg-text-primary/5 hover:text-accent-action-hi",
  );
}

export function Agents() {
  const { hasAnyCapability } = useAuth();
  const pendingApprovals = usePendingApprovals();
  const canReviewApprovals = hasAnyCapability(AGENTS_APPROVALS);
  const canManageConnections = hasAnyCapability(AGENTS_CONNECTIONS);

  return (
    <div className="space-y-5">
      <OpsPageHero
        title="Agents"
        description="Review what connected agents want to change and control their access."
      />
      <nav aria-label="Agents sections" className="flex flex-wrap gap-2">
        {canReviewApprovals ? (
          <NavLink to="/agents/approvals" className={sectionLinkClass}>
            Approvals
            {pendingApprovals > 0 ? (
              <>
                {" "}
                <StatusBadge tone="warning">
                  {pendingApprovals} <span className="sr-only">pending</span>
                </StatusBadge>
              </>
            ) : null}
          </NavLink>
        ) : null}
        {canManageConnections ? (
          <NavLink to="/agents/connections" className={sectionLinkClass}>
            Connections
          </NavLink>
        ) : null}
      </nav>
      <Outlet />
    </div>
  );
}

export function AgentsIndex() {
  const { hasAnyCapability } = useAuth();
  if (hasAnyCapability(AGENTS_APPROVALS)) {
    return <Navigate to="/agents/approvals" replace />;
  }
  return <Navigate to="/agents/connections" replace />;
}

export function LegacyPlanRedirect() {
  const { planId } = useParams();
  return (
    <Navigate
      to={
        planId
          ? `/agents/approvals/${encodeURIComponent(planId)}`
          : "/agents/approvals"
      }
      replace
    />
  );
}
