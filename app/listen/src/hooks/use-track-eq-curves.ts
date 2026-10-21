import type { Track } from "@/contexts/player-types";
import { useApi } from "@/hooks/use-api";
import { trackEffectiveEqApiPath } from "@/lib/library-routes";
import type { EqCurve, EqDataStatus } from "@/lib/equalizer-types";

/** Panel-only read; existing resolver/engine remain the sole audio authority. */
export function useTrackEqCurves(track: Track | undefined): {
  curves: EqCurve[] | null;
  status: EqDataStatus;
} {
  const base = track ? trackEffectiveEqApiPath(track) : null;
  const endpoint = base ? `${base}/curves` : null;
  const state = useApi<EqCurve[]>(endpoint, "GET", undefined, {
    reactive: true,
    reportCachedErrors: true,
    revalidateIfCached: "idle",
  });
  if (!track) return { curves: null, status: "idle" };
  if (!endpoint) return { curves: null, status: "unavailable" };
  if (state.error || (state.status != null && state.status >= 400))
    return { curves: state.data ? [] : null, status: "unavailable" };
  if (state.data) return { curves: state.data, status: "ready" };
  return { curves: null, status: state.loading ? "loading" : "unavailable" };
}
