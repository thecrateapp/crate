import { useEffect } from "react";

import { AppProviders } from "@/app-shell/AppProviders";
import { TauriDevLogPanel } from "@/components/dev/TauriDevLogPanel";
import { Shell } from "@/components/layout/Shell";
import { ShareSheetHost } from "@/components/share/ShareSheet";
import {
  isAndroidNativePlayerAvailable,
  setAndroidNativeSmartMixCapabilities,
} from "@/lib/android-native-engine";
import { api } from "@/lib/api";

type CapabilitiesResponse = {
  smart_mix: {
    available: boolean;
    planner_version: string | null;
    android_native_crossfade: boolean;
    android_beatmatch: boolean;
  };
};

export function AuthenticatedApp() {
  useEffect(() => {
    if (!isAndroidNativePlayerAvailable()) return;

    let active = true;
    void api<CapabilitiesResponse>("/api/capabilities")
      .then(({ smart_mix: smartMix }) => {
        if (!active) return;
        setAndroidNativeSmartMixCapabilities({
          available: smartMix.available,
          plannerVersion: smartMix.planner_version,
          androidNativeCrossfade: smartMix.android_native_crossfade,
          androidBeatmatch: smartMix.android_beatmatch,
        });
      })
      .catch(() => {
        if (!active) return;
        setAndroidNativeSmartMixCapabilities({
          available: false,
          plannerVersion: null,
          androidNativeCrossfade: false,
          androidBeatmatch: false,
        });
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <AppProviders>
      <Shell />
      <ShareSheetHost />
      <TauriDevLogPanel />
    </AppProviders>
  );
}
