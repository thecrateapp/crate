import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type NativeMediaControl =
  | "play"
  | "pause"
  | "next"
  | "previous"
  | "seekTo";

export type NativeMediaSessionPayload = {
  title: string;
  artist?: string;
  album?: string;
  artwork?: string;
  isPlaying: boolean;
  position: number;
  duration: number;
};

export type NativeMediaControlEvent = {
  control?: NativeMediaControl;
  position?: number;
};

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

export interface NativeOutputPickerResult {
  shown?: boolean;
  reason?: string;
}

type CrateMediaSessionBridge = {
  start(options: NativeMediaSessionPayload): Promise<void>;
  update(options: NativeMediaSessionPayload): Promise<void>;
  stop(options?: { suppressControl?: boolean }): Promise<void>;
  getOutputCapabilities(): Promise<NativeOutputCapabilities>;
  getCurrentRoute(): Promise<{ route?: NativeOutputRoute | null }>;
  showSystemOutputSwitcher(): Promise<NativeOutputPickerResult>;
  presentRoutePicker(): Promise<NativeOutputPickerResult>;
  addListener(
    eventName: "control",
    listener: (event: NativeMediaControlEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "routeChanged",
    listener: (event: { route?: NativeOutputRoute | null }) => void,
  ): Promise<PluginListenerHandle>;
};

const nativeMediaSessionBridge =
  registerPlugin<CrateMediaSessionBridge>("CrateMediaSession");

export function getNativeMediaSessionBridge(): CrateMediaSessionBridge {
  return nativeMediaSessionBridge;
}
