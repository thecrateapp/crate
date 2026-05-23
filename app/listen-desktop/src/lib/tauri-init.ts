import { consumeOAuthCallbackUrl } from "@/lib/capacitor-oauth";
import { recordDevLog } from "@/lib/dev-logs";
import {
  dispatchDesktopTrayCommand,
  type DesktopTrayCommand,
} from "@/lib/desktop-tray";
import { recordTauriAuthDiagnostic } from "@/lib/tauri-auth-diagnostic";

import { initLinuxScrollBehavior } from "./linux-scroll";
import { initLinuxDesktopTheme } from "./linux-theme";

export function initTauriRuntime(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.listenRuntime = "tauri";
  recordTauriAuthDiagnostic("OAuth bridge initializing");
  recordDevLog("tauri", "runtime init");
  installTauriInvokeBridge();
  initLinuxScrollBehavior();
  initLinuxDesktopTheme();
  ensureDesktopWindowSize();
  installNativeHttpFetch();
  void initTrayBridge();
  void initBandcampCookieBridge();
  installDeepLinkBridge();
  void initDeepLinks();
}

function ensureDesktopWindowSize(): void {
  const run = () => {
    void window
      .__crateTauriInvoke?.("ensure_desktop_window_size")
      .catch(() => undefined);
  };
  run();
  window.setTimeout(run, 250);
}

function installTauriInvokeBridge(): void {
  if (typeof window === "undefined" || window.__crateTauriInvoke) return;
  window.__crateTauriInvoke = async (command, args) => {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke(command, args);
  };
}

function installNativeHttpFetch(): void {
  if (typeof window === "undefined" || window.__crateTauriFetchInstalled)
    return;

  const browserFetch = window.fetch.bind(window);
  window.__crateTauriFetchInstalled = true;
  window.fetch = async (input, init) => {
    if (!isHttpRequest(input)) return browserFetch(input, init);

    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(input, init);
  };
}

function isHttpRequest(
  input: RequestInfo | URL,
): input is URL | Request | string {
  if (typeof input === "string")
    return input.startsWith("http://") || input.startsWith("https://");
  if (input instanceof URL)
    return input.protocol === "http:" || input.protocol === "https:";
  return input.url.startsWith("http://") || input.url.startsWith("https://");
}

async function initDeepLinks(): Promise<void> {
  try {
    const { getCurrent, onOpenUrl } = await import(
      "@tauri-apps/plugin-deep-link"
    );
    const { listen } = await import("@tauri-apps/api/event");

    await listen<string[]>("crate:deep-link", (event) => {
      recordTauriAuthDiagnostic(
        "Deep link event received",
        `${event.payload.length} URL(s)`,
      );
      void handleDeepLinkUrls(event.payload);
    });

    await onOpenUrl((urls) => {
      recordTauriAuthDiagnostic("Deep link opened", `${urls.length} URL(s)`);
      void handleDeepLinkUrls(urls);
    });

    const launchUrls = await getCurrent();
    if (launchUrls?.length) {
      recordTauriAuthDiagnostic(
        "Launch deep link found",
        `${launchUrls.length} URL(s)`,
      );
      await handleDeepLinkUrls(launchUrls);
    } else {
      recordTauriAuthDiagnostic("OAuth bridge ready");
    }
  } catch (err) {
    recordTauriAuthDiagnostic(
      "OAuth bridge failed",
      err instanceof Error ? err.message : String(err),
    );
    console.warn("[tauri] deep-link init failed", err);
  }
}

async function initTrayBridge(): Promise<void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<DesktopTrayCommand>("crate:tray-command", (event) => {
      recordDevLog("tauri", "tray command", event.payload, "debug");
      dispatchDesktopTrayCommand(event.payload);
    });
  } catch (err) {
    recordDevLog(
      "tauri",
      "tray bridge failed",
      err instanceof Error ? err.message : String(err),
      "warn",
    );
  }
}

async function initBandcampCookieBridge(): Promise<void> {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<{ cookie: string }>("crate:bandcamp-cookie", (event) => {
      window.dispatchEvent(
        new CustomEvent("crate:bandcamp-cookie", { detail: event.payload }),
      );
    });
  } catch (err) {
    recordDevLog(
      "tauri",
      "Bandcamp cookie bridge failed",
      err instanceof Error ? err.message : String(err),
      "warn",
    );
  }
}

function installDeepLinkBridge(): void {
  if (typeof window === "undefined") return;
  window.__crateHandleTauriDeepLinks = (urls) => {
    recordTauriAuthDiagnostic(
      "Deep link bridge invoked",
      `${urls.length} URL(s)`,
    );
    void handleDeepLinkUrls(urls);
  };
}

async function handleDeepLinkUrls(urls: string[]): Promise<void> {
  for (const url of urls) {
    const result = await consumeOAuthCallbackUrl(url);
    if (!result.handled) {
      recordTauriAuthDiagnostic(
        "Deep link ignored",
        protocolForDiagnostic(url),
      );
      continue;
    }
    recordTauriAuthDiagnostic("OAuth token stored", result.next);
    window.dispatchEvent(new CustomEvent("crate:auth-token-received"));
    return;
  }
}

function protocolForDiagnostic(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return "invalid-url";
  }
}

declare global {
  interface Window {
    __crateTauriFetchInstalled?: boolean;
    __crateHandleTauriDeepLinks?: (urls: string[]) => void;
    __crateTauriInvoke?: <T = unknown>(
      command: string,
      args?: Record<string, unknown>,
    ) => Promise<T>;
  }
}
