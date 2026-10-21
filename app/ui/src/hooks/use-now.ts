import { useEffect, useState } from "react";

/**
 * Returns `Date.now()`, refreshed every `intervalMs` so time-based state
 * (expiry, relative dates) re-evaluates without a reload.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
