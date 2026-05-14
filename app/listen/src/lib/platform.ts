import { Capacitor } from "@capacitor/core";

export type ListenRuntime = "web" | "capacitor" | "tauri";

function hasTauriInternals(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function getListenRuntime(): ListenRuntime {
  if (hasTauriInternals()) return "tauri";
  if (Capacitor.isNativePlatform()) return "capacitor";
  return "web";
}

export const listenRuntime = getListenRuntime();
export const capacitorPlatform = Capacitor.getPlatform();

export const isWebRuntime = listenRuntime === "web";
export const isCapacitorRuntime = listenRuntime === "capacitor";
export const isTauriRuntime = listenRuntime === "tauri";

export const usesConfigurableServer = isCapacitorRuntime || isTauriRuntime;
export const usesNativeFilesystem = isCapacitorRuntime || isTauriRuntime;
export const usesMobileShell = isCapacitorRuntime;
export const supportsHaptics = isCapacitorRuntime;
export const shouldRegisterServiceWorker = isWebRuntime;

export function getListenAppId(): string {
  if (isTauriRuntime) return "listen-tauri";
  if (isCapacitorRuntime) return `listen-${capacitorPlatform}`;
  return "listen-web";
}
