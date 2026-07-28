import {
  isAndroidNative,
  isIosNative,
  isNative,
} from "@/lib/capacitor-runtime";
import {
  getNativeMediaSessionBridge,
  type NativeOutputCapabilities,
  type NativeOutputPickerResult,
  type NativeOutputRoute,
} from "@/lib/native-media-session-bridge";

export type {
  NativeOutputCapabilities,
  NativeOutputRoute,
} from "@/lib/native-media-session-bridge";

export function isNativeOutputRoutingAvailable(): boolean {
  return isNative && (isAndroidNative || isIosNative);
}

export async function getNativeOutputCapabilities(): Promise<NativeOutputCapabilities> {
  if (!isNativeOutputRoutingAvailable()) {
    return {
      platform: "unknown",
      canShowSystemOutputSwitcher: false,
      canPresentRoutePicker: false,
      canReportCurrentRoute: false,
    };
  }
  try {
    return await getNativeMediaSessionBridge().getOutputCapabilities();
  } catch {
    return {
      platform: isAndroidNative ? "android" : isIosNative ? "ios" : "unknown",
      canShowSystemOutputSwitcher: false,
      canPresentRoutePicker: false,
      canReportCurrentRoute: false,
    };
  }
}

export async function getNativeCurrentOutputRoute(): Promise<NativeOutputRoute | null> {
  if (!isNativeOutputRoutingAvailable()) return null;
  try {
    const response = await getNativeMediaSessionBridge().getCurrentRoute();
    return response.route ?? null;
  } catch {
    return null;
  }
}

export async function showNativeOutputPicker(): Promise<NativeOutputPickerResult> {
  if (!isNativeOutputRoutingAvailable()) {
    return { shown: false, reason: "Native output routing is unavailable." };
  }
  try {
    if (isAndroidNative) {
      return await getNativeMediaSessionBridge().showSystemOutputSwitcher();
    }
    return await getNativeMediaSessionBridge().presentRoutePicker();
  } catch {
    return { shown: false, reason: "Could not open the system output picker." };
  }
}

export async function onNativeOutputRouteChanged(
  listener: (route: NativeOutputRoute | null) => void,
): Promise<() => void> {
  if (!isNativeOutputRoutingAvailable()) return () => {};
  const handle = await getNativeMediaSessionBridge().addListener(
    "routeChanged",
    (event) => {
      listener(event.route ?? null);
    },
  );
  return () => {
    void handle.remove();
  };
}
