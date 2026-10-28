type LinuxWindowPreferences = { windowButtonLayout?: string | null };
const MIN_REFRESH_INTERVAL_MS = 1_000;

let initialized = false;
let refreshInFlight: Promise<void> | null = null;
let lastRefreshAt: number | null = null;
let lastKnownLayout: string | null = null;

export function initLinuxDesktopTheme(): void {
  if (
    initialized ||
    typeof window === "undefined" ||
    typeof navigator === "undefined" ||
    !/\bLinux\b/i.test(navigator.userAgent)
  )
    return;
  initialized = true;
  const root = document.documentElement;
  delete root.dataset.crateLinuxTheme;
  delete root.dataset.crateLinuxScheme;
  root.style.removeProperty("--crate-linux-accent");
  root.style.removeProperty("--crate-linux-font-family");
  void refreshWindowPreferences();
  window.addEventListener("focus", () => void refreshWindowPreferences());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshWindowPreferences();
  });
}

function refreshWindowPreferences(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  const now = Date.now();
  if (lastRefreshAt !== null && now - lastRefreshAt < MIN_REFRESH_INTERVAL_MS)
    return Promise.resolve();
  lastRefreshAt = now;

  const refresh = (async () => {
    try {
      const snapshot =
        await window.__crateTauriInvoke?.<LinuxWindowPreferences | null>(
          "linux_desktop_theme_snapshot",
        );
      const layout = snapshot?.windowButtonLayout?.trim();
      if (layout && layout.length <= 128) lastKnownLayout = layout;
    } catch {
      console.warn("[tauri] Linux window preferences refresh failed");
    }
    if (lastKnownLayout)
      document.documentElement.dataset.crateLinuxWindowButtonLayout =
        lastKnownLayout;
  })();
  refreshInFlight = refresh;
  void refresh.finally(() => {
    if (refreshInFlight === refresh) refreshInFlight = null;
  });
  return refresh;
}
