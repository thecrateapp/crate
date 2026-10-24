import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** Search results and failures always belong to the currently visible query. */
export function useLibrarySearch<T>(
  open: boolean,
  initialQuery: string,
  collection: "artists" | "albums",
) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<T[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setResults([]);
    setError(null);
  }, [open, initialQuery]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(null);
    if (query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void api<Partial<Record<typeof collection, T[]>>>(
        `/api/search?q=${encodeURIComponent(query.trim())}&limit=12`,
      )
        .then((payload) => {
          if (active) setResults(payload[collection] ?? []);
        })
        .catch(() => {
          if (active) {
            setResults([]);
            setError(`Could not search ${collection}. Try again.`);
          }
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, query, collection, attempt]);
  return {
    query,
    setQuery,
    results,
    searching,
    error,
    retry: () => setAttempt((value) => value + 1),
  };
}
