import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import type { AgentCollection } from "@/lib/agent-integrations";

interface LoadedRange<T> {
  items: T[];
  nextCursor: string | null;
  /** How many pages make up `items`, so a reload can read the same range. */
  pages: number;
}

const EMPTY = { items: [], nextCursor: null, pages: 0 };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A cursor-paginated collection that grows with «Load more».
 *
 * - `reload()` reads the loaded range again from the top, as many pages as
 *   were loaded, so a refresh never collapses the list to its first page.
 * - `replace(item)` swaps one row for a fresh copy without any request.
 * - `retry()` repeats whatever failed: the next page keeps the loaded rows;
 *   a failed first page or reload reads the range again.
 */
export function useCursorList<T>(
  url: string | null,
  idOf: (item: T) => string | number,
): {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /** True when the failure was the next page, with earlier rows still shown. */
  moreFailed: boolean;
  nextCursor: string | null;
  loadMore: () => void;
  reload: () => void;
  retry: () => void;
  replace: (item: T) => void;
} {
  const [range, setRange] = useState<LoadedRange<T>>(EMPTY);
  const [loading, setLoading] = useState(url !== null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreFailed, setMoreFailed] = useState(false);
  // Bumped whenever a newer read supersedes the ones in flight (a new URL, a
  // reload, unmount); a response from an older generation is dropped.
  const generation = useRef(0);

  function pageUrl(base: string, cursor: string | null): string {
    if (!cursor) return base;
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}cursor=${encodeURIComponent(cursor)}`;
  }

  function merge(previous: T[], incoming: T[]): T[] {
    const next = [...previous];
    const seen = new Set(next.map(idOf));
    for (const item of incoming) {
      const id = idOf(item);
      if (seen.has(id)) continue;
      seen.add(id);
      next.push(item);
    }
    return next;
  }

  async function readRange(
    base: string,
    pageCount: number,
  ): Promise<LoadedRange<T>> {
    let items: T[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: AgentCollection<T> = await api<AgentCollection<T>>(
        pageUrl(base, cursor),
      );
      items = merge(items, page.items);
      cursor = page.next_cursor ?? null;
      pages += 1;
    } while (cursor && pages < pageCount);
    return { items, nextCursor: cursor, pages };
  }

  function startRead(pageCount: number, initial: boolean) {
    if (!url) return;
    const token = ++generation.current;
    if (initial) setLoading(true);
    setLoadingMore(false);
    setError(null);
    setMoreFailed(false);
    readRange(url, pageCount)
      .then((next) => {
        if (token === generation.current) setRange(next);
      })
      .catch((caught: unknown) => {
        if (token === generation.current) setError(errorMessage(caught));
      })
      .finally(() => {
        if (token === generation.current) setLoading(false);
      });
  }

  useEffect(() => {
    setRange(EMPTY);
    if (!url) {
      setLoading(false);
      return;
    }
    startRead(1, true);
    return () => {
      generation.current += 1;
    };
    // Only the URL identifies the collection; the read helpers are recreated
    // every render and are intentionally left out.
  }, [url]);

  function loadMore() {
    const cursor = range.nextCursor;
    if (!url || !cursor || loadingMore) return;
    const token = generation.current;
    setLoadingMore(true);
    setError(null);
    setMoreFailed(false);
    api<AgentCollection<T>>(pageUrl(url, cursor))
      .then((page) => {
        if (token !== generation.current) return;
        setRange((previous) => ({
          items: merge(previous.items, page.items),
          nextCursor: page.next_cursor ?? null,
          pages: previous.pages + 1,
        }));
      })
      .catch((caught: unknown) => {
        if (token !== generation.current) return;
        setError(errorMessage(caught));
        setMoreFailed(true);
      })
      .finally(() => {
        if (token === generation.current) setLoadingMore(false);
      });
  }

  function reload() {
    startRead(Math.max(1, range.pages), range.pages === 0);
  }

  function retry() {
    if (moreFailed) loadMore();
    else reload();
  }

  function replace(item: T) {
    const id = idOf(item);
    setRange((previous) => ({
      ...previous,
      items: previous.items.map((current) =>
        idOf(current) === id ? item : current,
      ),
    }));
  }

  return {
    items: url ? range.items : [],
    loading,
    loadingMore,
    error,
    moreFailed,
    nextCursor: range.nextCursor,
    loadMore,
    reload,
    retry,
    replace,
  };
}
