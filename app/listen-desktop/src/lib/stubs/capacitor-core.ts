import { convertFileSrc } from "@tauri-apps/api/core";

export type PermissionState =
  | "prompt"
  | "prompt-with-rationale"
  | "granted"
  | "denied";

export interface PluginListenerHandle {
  remove: () => Promise<void> | void;
}

export const Capacitor = {
  isNativePlatform: () => false,
  getPlatform: () => "web",
  convertFileSrc,
};

export function registerPlugin<T extends object = object>(
  _pluginName: string,
): T {
  return {} as T;
}
