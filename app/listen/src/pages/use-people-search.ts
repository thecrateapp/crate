import { useCallback, useEffect, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { api } from "@/lib/api";
import type { UserSearchResult } from "@/pages/people-types";
export const PEOPLE_SEARCH_DEBOUNCE_MS = 250;

export function usePeopleSearch(query: string) {
  const trimmed = query.trim();
  const debouncedQuery = useDebouncedValue(trimmed, PEOPLE_SEARCH_DEBOUNCE_MS);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({
    query: "",
    results: [] as UserSearchResult[],
    searching: false,
    error: false,
  });
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!debouncedQuery) {
      setState({ query: "", results: [], searching: false, error: false });
      return;
    }
    const controller = new AbortController();
    setState({
      query: debouncedQuery,
      results: [],
      searching: true,
      error: false,
    });
    api<UserSearchResult[]>(
      `/api/users/search?q=${encodeURIComponent(debouncedQuery)}&limit=12`,
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then((items) => {
        if (!controller.signal.aborted)
          setState({
            query: debouncedQuery,
            results: items || [],
            searching: false,
            error: false,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({
            query: debouncedQuery,
            results: [],
            searching: false,
            error: true,
          });
      });
    return () => controller.abort();
  }, [debouncedQuery, attempt]);
  const current = trimmed === state.query;
  return {
    results: current ? state.results : [],
    searching: !!trimmed && (!current || state.searching),
    error: current && state.error,
    retry,
  };
}
