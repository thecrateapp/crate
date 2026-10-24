import { useEffect, useLayoutEffect, useState } from "react";
import { shouldUseAndroidNativePlayer } from "@/lib/android-native-engine";

/** Local native telemetry has no authority over Cast, Connect or web playback. */
export function useNativeMixAvailability({
  castActive,
  remoteActive,
  setAvailable,
}: {
  castActive: boolean;
  remoteActive: boolean;
  setAvailable: (available: boolean) => void;
}): boolean {
  const [nativeEnabled, setNativeEnabled] = useState(
    shouldUseAndroidNativePlayer,
  );
  useEffect(() => {
    const update = () => setNativeEnabled(shouldUseAndroidNativePlayer());
    window.addEventListener("crate:native-player-pref-changed", update);
    return () =>
      window.removeEventListener("crate:native-player-pref-changed", update);
  }, []);
  const available = nativeEnabled && !castActive && !remoteActive;
  useLayoutEffect(() => {
    setAvailable(available);
  }, [available, setAvailable]);
  return available;
}
