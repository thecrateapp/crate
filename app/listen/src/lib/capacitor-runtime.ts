import { Capacitor } from "@capacitor/core";

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();
export const isAndroidNative = isNative && platform === "android";
export const isIosNative = isNative && platform === "ios";

function detectAndroidRuntime(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent || "");
}

function detectIosWebKitRuntime(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const navPlatform = navigator.platform || "";
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navPlatform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export const isAndroidBrowser = !isNative && detectAndroidRuntime();
export const isAndroidRuntime = isAndroidNative || isAndroidBrowser;
export const isIosBrowser = !isNative && detectIosWebKitRuntime();
export const isIosRuntime = isIosNative || isIosBrowser;

export function onAppPause(callback: () => void): () => void {
  if (!isNative) return () => {};
  const handle = import("@capacitor/app").then(({ App }) =>
    App.addListener("pause", callback),
  );
  return () => {
    void handle.then((listener) => listener.remove()).catch(() => undefined);
  };
}

export function onAppResume(callback: () => void): () => void {
  if (!isNative) return () => {};
  const handle = import("@capacitor/app").then(({ App }) =>
    App.addListener("resume", callback),
  );
  return () => {
    void handle.then((listener) => listener.remove()).catch(() => undefined);
  };
}

export async function isOnline(): Promise<boolean> {
  if (!isNative) return navigator.onLine;
  const { Network } = await import("@capacitor/network");
  const status = await Network.getStatus();
  return status.connected;
}
