import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type {
  InsightsWindow,
  SonicNeighbors,
  SonicTrack,
} from "./insights-model";

export function useSonicNeighbors(
  track: SonicTrack | undefined,
  window: InsightsWindow,
  active = true,
) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data?: SonicNeighbors;
    error?: boolean;
  } | null>(null);
  const id = track?.id;
  const hasBliss = track?.has_bliss === true;
  const key = `${window}:${id ?? "none"}:${attempt}`;
  useEffect(() => {
    if (!active || id === undefined || !hasBliss) return;
    const controller = new AbortController();
    let disposed = false;
    void api<SonicNeighbors>(
      `/api/admin/collection-insights/sonic-neighbors/${id}?window=${window}&limit=6`,
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then((data) => {
        if (disposed) return;
        if (data.seed_track_id !== id) {
          setResult({ key, error: true });
          return;
        }
        setResult({ key, data });
      })
      .catch(() => {
        if (!disposed) setResult({ key, error: true });
      });
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [id, hasBliss, window, key, active]);
  const current = result?.key === key ? result : null;
  return {
    data: hasBliss ? current?.data : undefined,
    error: hasBliss && current?.error === true,
    loading: hasBliss && !current,
    retry: () => setAttempt((value) => value + 1),
  };
}
