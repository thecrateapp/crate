import { useEffect, useRef } from "react";

const PENDING_REFRESH_INTERVAL_MS = 1_500;
const MAX_PENDING_REFRESHES = 40;

export function usePendingStatsSnapshotRefresh(
  pending: boolean,
  refetch: () => void,
): void {
  const attemptsRef = useRef(0);

  useEffect(() => {
    if (!pending) {
      attemptsRef.current = 0;
      return;
    }

    attemptsRef.current = 0;
    const timer = window.setInterval(() => {
      if (attemptsRef.current >= MAX_PENDING_REFRESHES) {
        window.clearInterval(timer);
        return;
      }
      attemptsRef.current += 1;
      refetch();
    }, PENDING_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [pending, refetch]);
}
