import { useEffect, useRef, useState } from "react";

// FED-D14 (decided by Diego, 2026-11-12): a submitted query goes to the network
// at once; a query that keeps changing waits for 300 ms of quiet, and anything
// under 3 characters never leaves the local library.
export const NETWORK_SEARCH_DEBOUNCE_MS = 300;
export const NETWORK_SEARCH_MIN_CHARS = 3;

export function networkSearchEligible(query: string): boolean {
  return query.replace(/\s+/g, "").length >= NETWORK_SEARCH_MIN_CHARS;
}

/**
 * The query to send to the network search, or null while there is none.
 *
 * The first query the page mounts with was submitted, so it goes at once.
 * Later changes reset to null and settle after the debounce, so quick changes
 * never open one network search each.
 */
export function useNetworkSearchQuery(
  query: string,
  enabled: boolean,
): string | null {
  const trimmed = query.trim();
  const eligible = enabled && networkSearchEligible(trimmed);
  const [settled, setSettled] = useState<string | null>(() =>
    eligible ? trimmed : null,
  );
  const firstRef = useRef(true);

  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      if (eligible) return;
    }
    setSettled(null);
    if (!eligible) return;
    const timer = setTimeout(
      () => setSettled(trimmed),
      NETWORK_SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [eligible, trimmed]);

  return eligible && settled === trimmed ? settled : null;
}
