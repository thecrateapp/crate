import { useSyncExternalStore } from "react";
import { subscribeUiPreferences } from "@crate/ui/lib/interface-preferences";
import { CONTENT_DENSITY_METRICS } from "@crate/ui/lib/content-density";
import type { ContentDensity } from "@crate/ui/lib/interface-preferences";

export { CONTENT_DENSITY_METRICS } from "@crate/ui/lib/content-density";

export function getContentDensity(): ContentDensity {
  if (typeof document === "undefined") return "comfortable";
  return document.documentElement.dataset.crateDensity === "compact"
    ? "compact"
    : "comfortable";
}

export function useContentDensity(): ContentDensity {
  return useSyncExternalStore(
    subscribeUiPreferences,
    getContentDensity,
    () => "comfortable" as const,
  );
}

export function getContentDensityMetrics() {
  return CONTENT_DENSITY_METRICS[getContentDensity()];
}
