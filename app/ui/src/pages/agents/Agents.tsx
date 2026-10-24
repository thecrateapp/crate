import { useEffect, useRef } from "react";
import {
  Navigate,
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "react-router";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@crate/ui/shadcn/tabs";

import { OpsPageHero } from "@/components/admin/ops-surfaces";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import { usePendingApprovals } from "@/hooks/use-pending-approvals";

const AGENTS_APPROVALS = ["agents.plans.review"] as const;
const AGENTS_CONNECTIONS = ["agents.integrations.manage"] as const;

export function Agents() {
  const { hasAnyCapability } = useAuth();
  const pendingApprovals = usePendingApprovals();
  const canReviewApprovals = hasAnyCapability(AGENTS_APPROVALS);
  const canManageConnections = hasAnyCapability(AGENTS_CONNECTIONS);

  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active =
    pathname.startsWith("/agents/connections") || !canReviewApprovals
      ? "connections"
      : "approvals";
  const requested = useRef(pathname);
  useEffect(() => {
    requested.current = pathname;
  }, [pathname]);
  const items = [
    ...(canReviewApprovals ? [{ value: "approvals", label: "Approvals" }] : []),
    ...(canManageConnections
      ? [{ value: "connections", label: "Connections" }]
      : []),
  ];
  function selectSection(next: string) {
    const target = `/agents/${next}`;
    if (
      !items.some((item) => item.value === next) ||
      requested.current === target
    )
      return;
    requested.current = target;
    navigate(target);
  }

  return (
    <div className="space-y-5">
      <OpsPageHero
        title="Agents"
        description="Review what connected agents want to change and control their access."
      />
      <Tabs value={active} onValueChange={selectSection}>
        <TabsList aria-label="Agents sections">
          {items.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              aria-label={
                item.value === "approvals" && pendingApprovals > 0
                  ? `${item.label} ${pendingApprovals} pending`
                  : item.label
              }
              asChild
            >
              <Link
                to={`/agents/${item.value}`}
                onMouseDown={(event) => {
                  if (
                    event.ctrlKey ||
                    event.metaKey ||
                    event.altKey ||
                    event.shiftKey
                  ) {
                    event.preventDefault();
                  }
                }}
                onClick={(event) => {
                  if (
                    event.button === 0 &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.altKey &&
                    !event.shiftKey
                  ) {
                    event.preventDefault();
                    selectSection(item.value);
                  }
                }}
              >
                {item.label}{" "}
                {item.value === "approvals" && pendingApprovals > 0 ? (
                  <StatusBadge tone="warning">
                    {pendingApprovals}
                    <span className="sr-only"> pending</span>
                  </StatusBadge>
                ) : null}
              </Link>
            </TabsTrigger>
          ))}
        </TabsList>
        {items.map((item) => (
          <TabsContent key={item.value} value={item.value}>
            {item.value === active ? <Outlet /> : null}
          </TabsContent>
        ))}
      </Tabs>
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
