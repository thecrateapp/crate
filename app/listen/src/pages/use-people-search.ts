import { useEffect, useState } from "react";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { api } from "@/lib/api";
import type { UserSearchResult } from "@/pages/people-types";

export const PEOPLE_SEARCH_DEBOUNCE_MS = 250;

export function usePeopleSearch(query: string) {
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const trimmed = query.trim();
  const debouncedQuery = useDebouncedValue(trimmed, PEOPLE_SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    if (!debouncedQuery) {
      setResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    setSearching(true);
    api<UserSearchResult[]>(
      `/api/users/search?q=${encodeURIComponent(debouncedQuery)}&limit=12`,
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then((items) => setResults(items || []))
      .catch(() => {
        if (!controller.signal.aborted) setResults([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });

    return () => controller.abort();
  }, [debouncedQuery]);

  return {
    results,
    searching: searching || (trimmed !== "" && trimmed !== debouncedQuery),
  };
}
