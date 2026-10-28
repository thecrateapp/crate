import { useEffect, useState } from "react";

import { EQ_PREFS_EVENT, getEqualizerEnabled } from "@/lib/equalizer-prefs";

export function useEqualizerEnabled(defaultEnabled?: boolean): boolean {
  const [enabled, setEnabled] = useState(() =>
    getEqualizerEnabled(defaultEnabled),
  );

  useEffect(() => {
    const sync = () => setEnabled(getEqualizerEnabled(defaultEnabled));
    window.addEventListener(EQ_PREFS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EQ_PREFS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [defaultEnabled]);

  return enabled;
}
