import type { ApiMethod } from "./api";
import { createApiClient } from "./api";

export interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

type ApiFn = ReturnType<typeof createApiClient>;

type RetryableApiError = Error & {
  status?: number;
  retryAfterMs?: number;
};

export function catalogWarmingRetryDelayMs(error: unknown): number | null {
  const apiError = error as RetryableApiError;
  if (apiError?.status !== 503) return null;
  let detail = "";
  try {
    const payload = JSON.parse(apiError.message) as { detail?: unknown };
    detail = String(payload.detail || "");
  } catch {
    detail = apiError.message || "";
  }
  if (detail !== "catalog_warming") return null;
  return Math.min(30_000, Math.max(500, apiError.retryAfterMs ?? 3_000));
}

interface ReactHookDeps {
  useState: <T>(
    initial: T | (() => T),
  ) => [T, (value: T | ((prev: T) => T)) => void];
  useEffect: (
    effect: () => void | (() => void),
    deps: readonly unknown[],
  ) => void;
  useCallback: <T extends (...args: never[]) => unknown>(
    fn: T,
    deps: readonly unknown[],
  ) => T;
  useRef: <T>(initial: T) => { current: T };
}

export function createUseApi(reactHooks: ReactHookDeps, apiFn: ApiFn) {
  const { useState, useEffect, useCallback, useRef } = reactHooks;

  return function useApi<T>(
    url: string | null,
    method: ApiMethod = "GET",
    body?: unknown,
  ): UseApiState<T> {
    const bodyKey = serializeBodyKey(body);
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(!!url);
    const [error, setError] = useState<string | null>(null);
    const [trigger, setTrigger] = useState(0);
    const hasFetched = useRef(false);

    const refetch = useCallback(() => setTrigger((t) => t + 1), []);

    useEffect(() => {
      if (!url) return;
      const controller = new AbortController();
      let cancelled = false;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;

      if (!hasFetched.current) {
        setLoading(true);
      }
      setError(null);

      const runRequest = () => {
        retryTimer = null;
        apiFn<T>(url, method, body, { signal: controller.signal })
          .then((nextData) => {
            if (!cancelled) {
              setData(nextData);
              hasFetched.current = true;
            }
          })
          .catch((error: Error) => {
            const wasAborted =
              controller.signal.aborted === true || error.name === "AbortError";
            const retryDelay =
              method === "GET" ? catalogWarmingRetryDelayMs(error) : null;
            if (!cancelled && !wasAborted && retryDelay != null) {
              retryTimer = setTimeout(runRequest, retryDelay);
              return;
            }
            if (!cancelled && !wasAborted) {
              setError(error.message);
            }
          })
          .finally(() => {
            if (!cancelled && retryTimer == null) {
              setLoading(false);
            }
          });
      };

      runRequest();

      return () => {
        cancelled = true;
        if (retryTimer != null) clearTimeout(retryTimer);
        controller.abort();
      };
    }, [apiFn, bodyKey, method, trigger, url]);

    useEffect(() => {
      hasFetched.current = false;
    }, [url]);

    return { data, loading, error, refetch };
  };
}

function serializeBodyKey(body: unknown): string {
  if (body == null) return "";
  if (body instanceof FormData) {
    return Array.from(body.entries())
      .map(
        ([key, value]) =>
          `${key}:${typeof value === "string" ? value : value.name}`,
      )
      .join("&");
  }
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}
