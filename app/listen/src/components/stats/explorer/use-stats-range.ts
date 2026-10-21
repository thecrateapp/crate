import { useEffect, useReducer, useState } from "react";

import type { StatsRange } from "@/components/stats/stats-types";
import { api } from "@/lib/api";

const DEBOUNCE_MS = 300;
const MAX_CACHE_ENTRIES = 32;

const rangeCache = new Map<string, StatsRange>();

function cacheSet(key: string, value: StatsRange) {
  rangeCache.delete(key);
  rangeCache.set(key, value);
  while (rangeCache.size > MAX_CACHE_ENTRIES) {
    const oldest = rangeCache.keys().next().value;
    if (oldest === undefined) break;
    rangeCache.delete(oldest);
  }
}

/** Test-only: empties the module-level range cache. */
export function __resetStatsRangeCache() {
  rangeCache.clear();
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AbortError"
  );
}

export interface UseStatsRangeResult {
  data: StatsRange | null;
  loading: boolean;
  error: boolean;
}

export function useStatsRange(
  base: string | null,
  range: { start: string; end: string } | null,
  limit: number,
): UseStatsRangeResult {
  const key = base && range ? buildKey(base, range, limit) : null;
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!key || rangeCache.has(key)) return;
    const controller = new AbortController();
    let cancelled = false;
    const timer = setTimeout(() => {
      api<StatsRange>(key, "GET", undefined, { signal: controller.signal })
        .then((payload) => {
          cacheSet(key, payload);
          if (cancelled) return;
          setErrorKey(null);
          bump();
        })
        .catch((e: unknown) => {
          if (cancelled || controller.signal.aborted || isAbort(e)) return;
          setErrorKey(key);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  const data = key ? (rangeCache.get(key) ?? null) : null;
  const error = key !== null && data === null && errorKey === key;
  return { data, loading: key !== null && data === null && !error, error };
}

function buildKey(
  base: string,
  range: { start: string; end: string },
  limit: number,
): string {
  const params = new URLSearchParams({
    start: range.start,
    end: range.end,
    limit: String(limit),
  });
  return `${base}?${params.toString()}`;
}
