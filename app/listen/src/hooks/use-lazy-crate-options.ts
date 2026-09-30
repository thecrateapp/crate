import { useCallback, useMemo, useState } from "react";

import { useApi } from "@/hooks/use-api";
import type { CrateSummary } from "@/pages/crates-types";

export interface CrateOption {
  id: string;
  name: string;
}

export function useLazyCrateOptions(initiallyEnabled = false) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const { data } = useApi<CrateSummary[]>(enabled ? "/api/me/crates" : null);

  const ensureCrateOptionsLoaded = useCallback(() => {
    setEnabled(true);
  }, []);

  const crateOptions = useMemo<CrateOption[]>(
    () =>
      (data ?? []).map((crate) => ({
        id: crate.id,
        name: crate.name,
      })),
    [data],
  );

  return {
    crateOptions,
    ensureCrateOptionsLoaded,
  };
}
