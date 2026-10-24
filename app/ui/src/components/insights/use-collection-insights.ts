import { useEffect, useRef, useState } from "react";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { waitForTask } from "@/lib/tasks";
import type { CollectionInsights, InsightsWindow } from "./insights-model";

export function useCollectionInsights(window: InsightsWindow) {
  const path = `/api/admin/collection-insights?window=${window}`;
  const state = useApi<CollectionInsights>(path);
  const [requesting, setRequesting] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshed, setRefreshed] = useState<{
    generation: number;
    data: CollectionInsights;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const activeWindow = useRef(window);
  const windowGeneration = useRef(0);
  if (activeWindow.current !== window) {
    activeWindow.current = window;
    windowGeneration.current += 1;
  }
  // useApi intentionally retains data on URL changes. Never label it as a new period.
  const cached = state.data?.window === window ? state.data : null;
  // A manual response belongs to one visit. Re-entering the same period must
  // accept its new GET/task/error status instead of resurrecting an old response.
  const fresh =
    refreshed?.generation === windowGeneration.current &&
    refreshed.data.window === window
      ? refreshed.data
      : null;
  const data =
    fresh &&
    (!cached ||
      (fresh.snapshot?.built_at ?? "") >= (cached.snapshot?.built_at ?? ""))
      ? fresh
      : cached;
  // A fresh request may return the same stale payload while scheduling a refresh. Its task
  // belongs to the response even if an older built_at makes the cached report preferable.
  const latestResponse = fresh ?? cached;
  const responseFailed = latestResponse?.snapshot?.refresh_error === true;
  const taskId = responseFailed
    ? null
    : (latestResponse?.snapshot?.task_id ?? null);

  useEffect(() => {
    setRefreshError(null);
    setWaiting(false);
    if (!taskId) return;
    const controller = new AbortController();
    const generation = windowGeneration.current;
    setWaiting(true);
    void waitForTask(taskId, 120000, controller.signal)
      .then(async (completion) => {
        if (controller.signal.aborted) return;
        if (completion.status !== "completed")
          throw new Error(
            completion.error ?? "Snapshot refresh did not complete",
          );
        const next = await api<CollectionInsights>(path);
        if (!controller.signal.aborted && next.window === window)
          setRefreshed({ generation, data: next });
      })
      .catch(() => {
        if (!controller.signal.aborted) setRefreshError("Refresh failed");
      })
      .finally(() => {
        if (!controller.signal.aborted) setWaiting(false);
      });
    return () => controller.abort();
  }, [window, taskId, attempt]);

  async function refresh() {
    if (requesting || waiting) return;
    const requestedWindow = window;
    const requestedGeneration = windowGeneration.current;
    setRequesting(true);
    setRefreshError(null);
    try {
      const next = await api<CollectionInsights>(`${path}&fresh=true`);
      if (
        activeWindow.current === requestedWindow &&
        windowGeneration.current === requestedGeneration &&
        next.window === requestedWindow
      ) {
        setRefreshed({ generation: requestedGeneration, data: next });
        setAttempt((value) => value + 1);
      }
    } catch {
      if (
        activeWindow.current === requestedWindow &&
        windowGeneration.current === requestedGeneration
      )
        setRefreshError("Refresh failed");
    } finally {
      setRequesting(false);
    }
  }
  return {
    data,
    error:
      refreshError ??
      (responseFailed ? "Refresh failed" : fresh ? null : state.error),
    refreshing: requesting || waiting,
    refresh,
  };
}
