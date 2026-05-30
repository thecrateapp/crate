import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

import {
  isAndroidNative,
  isIosNative,
  isNative,
} from "@/lib/capacitor-runtime";

export interface NativeOutputCapabilities {
  platform: "android" | "ios" | "unknown";
  canShowSystemOutputSwitcher: boolean;
  canPresentRoutePicker: boolean;
  canReportCurrentRoute: boolean;
  routePickerKind?: "android-output-switcher" | "ios-route-picker";
}

export interface NativeOutputRoute {
  id: string;
  name: string;
  type: string;
  platform: "android" | "ios" | "unknown";
}

interface NativeOutputRouteEvent {
  route?: NativeOutputRoute | null;
}

interface NativeOutputPickerResult {
  shown?: boolean;
  reason?: string;
}

type CrateNativeOutputRouterPlugin = {
  getOutputCapabilities(): Promise<NativeOutputCapabilities>;
  getCurrentRoute(): Promise<{ route?: NativeOutputRoute | null }>;
  showSystemOutputSwitcher(): Promise<NativeOutputPickerResult>;
  presentRoutePicker(): Promise<NativeOutputPickerResult>;
  addListener(
    eventName: "routeChanged",
    listener: (event: NativeOutputRouteEvent) => void,
  ): Promise<PluginListenerHandle>;
};

let nativeOutputRouter: CrateNativeOutputRouterPlugin | null = null;

function getNativeOutputRouter(): CrateNativeOutputRouterPlugin {
  nativeOutputRouter ??=
    registerPlugin<CrateNativeOutputRouterPlugin>("CrateMediaSession");
  return nativeOutputRouter;
}

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
    return await getNativeOutputRouter().getOutputCapabilities();
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
    const response = await getNativeOutputRouter().getCurrentRoute();
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
      return await getNativeOutputRouter().showSystemOutputSwitcher();
    }
    return await getNativeOutputRouter().presentRoutePicker();
  } catch {
    return { shown: false, reason: "Could not open the system output picker." };
  }
}

export async function onNativeOutputRouteChanged(
  listener: (route: NativeOutputRoute | null) => void,
): Promise<() => void> {
  if (!isNativeOutputRoutingAvailable()) return () => {};
  const handle = await getNativeOutputRouter().addListener(
    "routeChanged",
    (event) => {
      listener(event.route ?? null);
    },
  );
  return () => {
    void handle.remove();
  };
}
