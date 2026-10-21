import { useEffect, useReducer, useState } from "react";

import type { StatsRange } from "@/components/stats/stats-types";
import { api } from "@/lib/api";
import { cacheScopedKey, onCacheInvalidation } from "@/lib/cache";

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

// Stats URLs belong to the "history" scope: a play event refreshes stretches.
let generation = 0;
const generationListeners = new Set<() => void>();
onCacheInvalidation((scope) => {
  if (scope !== "history") return;
  rangeCache.clear();
  generation += 1;
  for (const fn of generationListeners) fn();
});

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
  unsupported: boolean;
}

export function useStatsRange(
  base: string | null,
  range: { start: string; end: string } | null,
  limit: number,
): UseStatsRangeResult {
  const url = base && range ? buildUrl(base, range, limit) : null;
  // Entries are scoped to the current server and user so accounts never mix.
  const key = url ? cacheScopedKey(url) : null;
  const endpointScope = base ? cacheScopedKey(base) : null;
  const [unsupportedScope, setUnsupportedScope] = useState<string | null>(null);
  const unsupported =
    endpointScope !== null && unsupportedScope === endpointScope;
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // "Still being prepared" (available=false) answers are shown but never
  // cached, so the next visit asks again once the instance backfill finishes.
  const [uncached, setUncached] = useState<{
    key: string;
    data: StatsRange;
  } | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    generationListeners.add(bump);
    return () => {
      generationListeners.delete(bump);
    };
  }, []);

  const seenGeneration = generation;

  useEffect(() => {
    if (!key || unsupported || rangeCache.has(key)) return;
    const controller = new AbortController();
    let cancelled = false;
    // A history clear can land while the request is in flight, before React
    // cleans up this effect; its response then belongs to the cleared cache.
    const startedGeneration = generation;
    setErrorKey(null);
    const timer = setTimeout(() => {
      api<StatsRange>(url as string, "GET", undefined, {
        signal: controller.signal,
      })
        .then((payload) => {
          const current = generation === startedGeneration;
          const ready = payload.available !== false;
          if (current && ready) cacheSet(key, payload);
          if (cancelled) return;
          setErrorKey(null);
          // A superseded response is dropped: the generation bump refetches.
          if (!current) return;
          if (ready) bump();
          else setUncached({ key, data: payload });
        })
        .catch((e: unknown) => {
          if (cancelled || controller.signal.aborted || isAbort(e)) return;
          const status =
            typeof e === "object" && e !== null && "status" in e
              ? e.status
              : null;
          if (status === 404 || status === 405 || status === 501) {
            setUnsupportedScope(endpointScope);
            return;
          }
          setErrorKey(key);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, seenGeneration, unsupported, endpointScope]);

  const data = key
    ? (rangeCache.get(key) ?? (uncached?.key === key ? uncached.data : null))
    : null;
  const error = key !== null && data === null && errorKey === key;
  return {
    data,
    loading: key !== null && data === null && !error && !unsupported,
    error,
    unsupported,
  };
}

function buildUrl(
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
