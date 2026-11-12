import { useEffect } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import {
  BACKUPS_API,
  BACKUPS_CHANGED_EVENT,
  BACKUPS_MANAGE,
} from "@/lib/backups";

/**
 * Failing backup destinations, for the sidebar counter (BG1-1). Refetched on
 * focus and after the Backups page changes something.
 */
export function useBackupsFailingCount(): number {
  const { hasAnyCapability } = useAuth();
  const enabled = hasAnyCapability(BACKUPS_MANAGE);
  const { data, refetch } = useApi<{ failing_count: number }>(
    enabled ? `${BACKUPS_API}/overview` : null,
  );

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("focus", refetch);
    window.addEventListener(BACKUPS_CHANGED_EVENT, refetch);
    return () => {
      window.removeEventListener("focus", refetch);
      window.removeEventListener(BACKUPS_CHANGED_EVENT, refetch);
    };
    // refetch is stable (useApi's refetch is useCallback([])); keyed on `enabled` only.
  }, [enabled]);

  if (!enabled) return 0;
  return data?.failing_count ?? 0;
}
