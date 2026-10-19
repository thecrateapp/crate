import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

interface TabParamOptions<T extends string> {
  path?: { value: string; pathname: (value: T) => string };
  param?: string;
  replace?: boolean;
}

/** URL-backed panel selection. Unknown values fall back without rewriting links.
 * Changes push history unless replace is requested; other query values and the
 * current route/hash/state survive. Path-based tabs may supply an explicit route adapter.
 */
export function useTabParam<T extends string>(
  values: readonly T[],
  defaultValue: T,
  { param = "tab", replace = false, path }: TabParamOptions<T> = {},
): readonly [T, (value: string) => void] {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const pendingWrite = useRef<string | null>(null);
  useEffect(() => {
    pendingWrite.current = null;
  }, [location.key, location.search]);
  const rawValue = path?.value ?? searchParams.get(param);
  const tab = values.find((value) => value === rawValue) ?? defaultValue;

  const setTab = useCallback(
    (value: string) => {
      if (
        !values.some((candidate) => candidate === value) ||
        rawValue === value
      )
        return;
      const next = new URLSearchParams(searchParams);
      if (!path) next.set(param, value);
      const pathname = path ? path.pathname(value as T) : location.pathname;
      const search = path ? location.search : `?${next}`;
      const destination = `${pathname}${search}${location.hash}`;
      // Radix can emit the same selection on pointer-down and focus before the
      // router commits. One gesture must add only one history entry.
      if (pendingWrite.current === destination) return;
      pendingWrite.current = destination;
      void navigate(
        {
          pathname,
          search,
          hash: location.hash,
        },
        {
          replace,
          preventScrollReset: true,
          state: location.state,
        },
      );
    },
    [
      values,
      path,
      rawValue,
      location.search,
      searchParams,
      param,
      navigate,
      location.pathname,
      location.hash,
      location.state,
      replace,
    ],
  );

  return [tab, setTab];
}
