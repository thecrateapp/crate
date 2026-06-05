import {
  isAndroidNative,
  isIosNative,
  isNative,
  platform,
} from "@/lib/capacitor-runtime";
import { isTauriRuntime } from "@/lib/platform";

export type ListenDeviceType =
  | "android"
  | "desktop"
  | "ipad"
  | "iphone"
  | "web";
export type ListenAppPlatform =
  | "listen-android"
  | "listen-ios"
  | "listen-tauri"
  | "listen-web";

const DEVICE_FINGERPRINT_KEY = "listen-device-fingerprint";
const LEGACY_DEVICE_LABELS: Record<string, string> = {
  "Android (Listen)": "Crate on Android",
  "Desktop (Listen)": "Crate Desktop",
  "iPad (Listen)": "Crate on iPad",
  "iPhone (Listen)": "Crate on iPhone",
  "Web (Listen)": "Crate on Browser",
};

export interface ListenDeviceCapabilities {
  can_play: boolean;
  can_receive_commands: boolean;
  can_background_play: boolean;
  can_set_volume: boolean;
  supports_native_audio: boolean;
  supports_cast_sender: boolean;
}

export function isIpadRuntime(): boolean {
  if (platform !== "ios") return false;
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const navPlatform = navigator.platform || "";
  return (
    /iPad/i.test(ua) ||
    (navPlatform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function getListenDeviceType(): ListenDeviceType {
  if (isTauriRuntime) return "desktop";
  if (isAndroidNative) return "android";
  if (isIosNative) return isIpadRuntime() ? "ipad" : "iphone";
  return "web";
}

export function getListenAppPlatform(): ListenAppPlatform {
  if (isTauriRuntime) return "listen-tauri";
  if (!isNative) return "listen-web";
  if (platform === "android") return "listen-android";
  if (platform === "ios") return "listen-ios";
  return "listen-web";
}

function userAgent(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent || "";
}

function navigatorPlatform(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.platform || "";
}

function detectBrowserName(): string {
  const ua = userAgent();
  if (/EdgA|EdgiOS|Edg\//i.test(ua)) return "Edge";
  if (/OPR\/|OPiOS/i.test(ua)) return "Opera";
  if (/SamsungBrowser/i.test(ua)) return "Samsung Internet";
  if (/CriOS|Chrome\/|Chromium\//i.test(ua)) return "Chrome";
  if (/FxiOS|Firefox\//i.test(ua)) return "Firefox";
  if (/Version\/.+Safari\/|Safari\//i.test(ua)) return "Safari";
  return "Browser";
}

function detectDesktopOsName(): string | null {
  const ua = userAgent();
  const navPlatform = navigatorPlatform();
  if (/Mac/i.test(navPlatform) || /Mac OS X/i.test(ua)) return "macOS";
  if (/Win/i.test(navPlatform) || /Windows/i.test(ua)) return "Windows";
  if (/Linux|X11/i.test(navPlatform) || /Linux/i.test(ua)) return "Linux";
  return null;
}

function detectMobileOsName(): string | null {
  const ua = userAgent();
  if (/Android/i.test(ua)) return "Android";
  if (/iPad|iPhone|iPod/i.test(ua) || isIpadRuntime()) return "iOS";
  return null;
}

function isMobileBrowser(): boolean {
  const ua = userAgent();
  return /Android|iPad|iPhone|iPod|Mobile/i.test(ua) || isIpadRuntime();
}

export function getListenDeviceLabel(): string {
  switch (getListenDeviceType()) {
    case "android":
      return "Crate on Android";
    case "ipad":
      return "Crate on iPad";
    case "iphone":
      return "Crate on iPhone";
    case "desktop":
      return detectDesktopOsName()
        ? `Crate on ${detectDesktopOsName()}`
        : "Crate Desktop";
    default:
      if (isMobileBrowser()) {
        const osName = detectMobileOsName();
        return osName
          ? `Crate on Mobile ${detectBrowserName()} (${osName})`
          : `Crate on Mobile ${detectBrowserName()}`;
      }
      return `Crate on ${detectBrowserName()}`;
  }
}

export function formatCrateAppPlatform(
  appPlatform?: string | null,
): string | null {
  switch (appPlatform) {
    case "listen-android":
      return "Android app";
    case "listen-ios":
      return "iOS app";
    case "listen-tauri":
      return "Desktop app";
    case "listen-web":
      return "Web app";
    default:
      return humanizeDeviceToken(appPlatform);
  }
}

export function formatCrateDeviceType(
  deviceType?: string | null,
): string | null {
  switch (deviceType) {
    case "android":
      return "Android";
    case "desktop":
      return "Desktop";
    case "ipad":
      return "iPad";
    case "iphone":
      return "iPhone";
    case "web":
      return "Browser";
    default:
      return humanizeDeviceToken(deviceType);
  }
}

function humanizeDeviceToken(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed
    .replace(/^listen[-_\s]*/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatCrateDeviceName(options: {
  app_platform?: string | null;
  device_label?: string | null;
  device_type?: string | null;
}): string {
  const label = options.device_label?.trim();
  if (label) {
    return (
      LEGACY_DEVICE_LABELS[label] ?? label.replace(/\s*\(Listen\)\s*$/i, "")
    );
  }
  switch (options.app_platform) {
    case "listen-android":
      return "Crate on Android";
    case "listen-ios":
      return options.device_type === "ipad"
        ? "Crate on iPad"
        : options.device_type === "iphone"
          ? "Crate on iPhone"
          : "Crate on iOS";
    case "listen-tauri":
      return "Crate Desktop";
    case "listen-web":
      return "Crate on Browser";
    default: {
      const typeLabel = formatCrateDeviceType(options.device_type);
      return typeLabel ? `Crate on ${typeLabel}` : "Crate device";
    }
  }
}

function generateDeviceFingerprint(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `listen:${crypto.randomUUID()}`;
  }
  return `listen:${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

export function getListenDeviceFingerprint(): string {
  try {
    const existing = localStorage.getItem(DEVICE_FINGERPRINT_KEY);
    if (existing) return existing;
    const next = generateDeviceFingerprint();
    localStorage.setItem(DEVICE_FINGERPRINT_KEY, next);
    return next;
  } catch {
    return `${getListenAppPlatform()}:${getListenDeviceLabel()}`;
  }
}

export function getListenDeviceId(): string {
  return getListenDeviceFingerprint();
}

export function getListenDeviceCapabilities(): ListenDeviceCapabilities {
  const native = isNative || isTauriRuntime;
  return {
    can_play: true,
    can_receive_commands: true,
    can_background_play: native,
    can_set_volume: true,
    supports_native_audio: isAndroidNative,
    supports_cast_sender: false,
  };
}
