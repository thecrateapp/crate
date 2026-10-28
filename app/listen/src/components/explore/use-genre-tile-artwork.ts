import { useCallback, useState } from "react";

export function useGenreTileArtwork(candidates: string[]) {
  const fingerprint = candidates.join("|");
  const [state, setState] = useState({ fingerprint, index: 0 });
  const index = state.fingerprint === fingerprint ? state.index : 0;
  const onError = useCallback(() => {
    setState((previous) => ({
      fingerprint,
      index: Math.min(
        (previous.fingerprint === fingerprint ? previous.index : 0) + 1,
        candidates.length,
      ),
    }));
  }, [candidates.length, fingerprint]);
  return { url: candidates[index] ?? null, onError };
}
