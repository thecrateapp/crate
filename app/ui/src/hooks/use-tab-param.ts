import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

interface TabParamOptions {
  param?: string;
  replace?: boolean;
}

/** URL-backed panel selection. Unknown values fall back without rewriting links.
 * Changes push history unless replace is requested; other query values and the
 * current route/hash/state survive. Pages with path-based tabs keep their adapter.
 */
export function useTabParam<T extends string>(
  values: readonly T[],
  defaultValue: T,
  { param = "tab", replace = false }: TabParamOptions = {},
): readonly [T, (value: string) => void] {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const rawValue = searchParams.get(param);
  const tab = values.find((value) => value === rawValue) ?? defaultValue;

  const setTab = useCallback(
    (value: string) => {
      if (
        !values.some((candidate) => candidate === value) ||
        searchParams.get(param) === value
      )
        return;
      const next = new URLSearchParams(searchParams);
      next.set(param, value);
      void navigate(
        {
          pathname: location.pathname,
          search: `?${next}`,
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
