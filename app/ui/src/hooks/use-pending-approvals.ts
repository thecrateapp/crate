import { useEffect } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";

export const AGENT_PLANS_CHANGED_EVENT = "crate:agent-plans-changed";

export function notifyAgentPlansChanged(): void {
  window.dispatchEvent(new Event(AGENT_PLANS_CHANGED_EVENT));
}

const AGENTS_PLANS_REVIEW = ["agents.plans.review"] as const;

export function usePendingApprovals(): number {
  const { hasAnyCapability } = useAuth();
  const enabled = hasAnyCapability(AGENTS_PLANS_REVIEW);
  const { data, loading, error, refetch } = useApi<{
    awaiting_approval: number;
  }>(enabled ? "/api/admin/agent-plans/summary" : null);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("focus", refetch);
    window.addEventListener(AGENT_PLANS_CHANGED_EVENT, refetch);
    return () => {
      window.removeEventListener("focus", refetch);
      window.removeEventListener(AGENT_PLANS_CHANGED_EVENT, refetch);
    };
    // refetch is stable (useApi's refetch is useCallback([])); keyed on `enabled` only.
  }, [enabled]);

  if (!enabled || loading || error) return 0;
  return data?.awaiting_approval ?? 0;
}
