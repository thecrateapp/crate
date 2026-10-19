import { useEffect, useRef, useState } from "react";

import { useApi } from "@/hooks/use-api";
import type { AgentCollection } from "@/lib/agent-integrations";

/**
 * A cursor-paginated collection that grows with «Load more». `refresh()`
 * goes back to the first page and replaces what was loaded, so rows changed
 * by a mutation are read again instead of being kept from an older page.
 */
export function useCursorList<T>(
  url: string | null,
  idOf: (item: T) => string | number,
): {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  nextCursor: string | null;
  loadMore: () => void;
  refresh: () => void;
} {
  const [cursor, setCursor] = useState<string | null>(null);
  const [items, setItems] = useState<T[]>([]);
  // useApi keeps `loading` false after the first page, so the next page's
  // request is tracked here.
  const [loadingMore, setLoadingMore] = useState(false);
  const handled = useRef<AgentCollection<T> | null>(null);
  const separator = url?.includes("?") ? "&" : "?";
  const { data, loading, error, refetch } = useApi<AgentCollection<T>>(
    url
      ? `${url}${
          cursor ? `${separator}cursor=${encodeURIComponent(cursor)}` : ""
        }`
      : null,
  );

  useEffect(() => {
    // A cursor change alone re-runs this effect with the previous page; only
    // a newly arrived page is merged.
    if (!data || data === handled.current) return;
    handled.current = data;
    setLoadingMore(false);
    setItems((previous) => {
      const next = cursor ? [...previous] : [];
      const seen = new Set(next.map(idOf));
      for (const item of data.items) {
        const id = idOf(item);
        if (seen.has(id)) continue;
        seen.add(id);
        next.push(item);
      }
      return next;
    });
    // `cursor` decides replace-vs-append for the page that just arrived.
  }, [data, cursor]);

  useEffect(() => {
    if (error) setLoadingMore(false);
  }, [error]);

  const nextCursor = data?.next_cursor ?? null;

  function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    // Retrying a page that failed keeps the same cursor, so ask again.
    if (nextCursor === cursor) refetch();
    else setCursor(nextCursor);
  }

  function refresh() {
    setLoadingMore(false);
    setCursor(null);
    refetch();
  }

  return {
    items: url ? items : [],
    loading,
    loadingMore,
    error,
    nextCursor,
    loadMore,
    refresh,
  };
}
