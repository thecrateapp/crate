type LinuxDesktopThemeSnapshot = {
  scheme?: "dark" | "light" | string | null;
  accent?: string | null;
  gtkTheme?: string | null;
  windowButtonLayout?: string | null;
  iconTheme?: string | null;
  cursorTheme?: string | null;
  fontName?: string | null;
  textScale?: number | null;
  source?: string[] | null;
};

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const GTK_FONT_SIZE_SUFFIX_RE = /\s+\d+(?:\.\d+)?$/;
const CSS_STRING_ESCAPE_RE = /["\\]/g;
const MIN_REFRESH_INTERVAL_MS = 1_000;

let initialized = false;
let refreshInFlight: Promise<void> | null = null;
let lastRefreshAt: number | null = null;
let lastKnownSnapshot: LinuxDesktopThemeSnapshot | null = null;
let lastAppliedSnapshotKey: string | null = null;

export function initLinuxDesktopTheme(): void {
  if (initialized || typeof window === "undefined" || !isLinuxWebView()) return;
  initialized = true;

  void refreshLinuxDesktopTheme();
  window.addEventListener("focus", () => void refreshLinuxDesktopTheme());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void refreshLinuxDesktopTheme();
    }
  });
}

function isLinuxWebView(): boolean {
  return (
    typeof navigator !== "undefined" && /\bLinux\b/i.test(navigator.userAgent)
  );
}

function refreshLinuxDesktopTheme(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;

  const now = Date.now();
  if (lastRefreshAt !== null && now - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) {
    return Promise.resolve();
  }
  lastRefreshAt = now;

  const refresh = (async () => {
    try {
      const snapshot =
        await window.__crateTauriInvoke?.<LinuxDesktopThemeSnapshot | null>(
          "linux_desktop_theme_snapshot",
        );
      if (!snapshot || !hasThemeSignal(snapshot)) {
        if (lastKnownSnapshot) applyLinuxDesktopTheme(lastKnownSnapshot);
        return;
      }

      lastKnownSnapshot = mergeThemeSnapshot(lastKnownSnapshot, snapshot);
      applyLinuxDesktopTheme(lastKnownSnapshot);
    } catch {
      console.warn("[tauri] Linux desktop theme refresh failed");
      if (lastKnownSnapshot) applyLinuxDesktopTheme(lastKnownSnapshot);
    }
  })();

  refreshInFlight = refresh;
  void refresh.finally(() => {
    if (refreshInFlight === refresh) refreshInFlight = null;
  });
  return refresh;
}

function applyLinuxDesktopTheme(snapshot: LinuxDesktopThemeSnapshot): void {
  if (typeof document === "undefined") return;

  const scheme = normalizeScheme(snapshot.scheme);
  const accent = normalizeHexColor(snapshot.accent);
  const fontFamily = fontFamilyFromGtkFont(snapshot.fontName);
  const windowButtonLayout = normalizeWindowButtonLayout(
    snapshot.windowButtonLayout,
  );

  const snapshotKey = JSON.stringify({
    scheme,
    accent,
    fontFamily,
    windowButtonLayout,
  });
  if (snapshotKey === lastAppliedSnapshotKey) return;
  lastAppliedSnapshotKey = snapshotKey;

  const root = document.documentElement;
  root.dataset.crateLinuxTheme = "true";
  if (scheme) {
    root.dataset.crateLinuxScheme = scheme;
  } else {
    delete root.dataset.crateLinuxScheme;
  }

  setCssProperty(root, "--crate-linux-accent", accent);
  setCssProperty(root, "--crate-linux-font-family", fontFamily);

  if (windowButtonLayout) {
    root.dataset.crateLinuxWindowButtonLayout = windowButtonLayout;
  } else {
    delete root.dataset.crateLinuxWindowButtonLayout;
  }
}

function mergeThemeSnapshot(
  previous: LinuxDesktopThemeSnapshot | null,
  next: LinuxDesktopThemeSnapshot,
): LinuxDesktopThemeSnapshot {
  return {
    scheme: next.scheme ?? previous?.scheme,
    accent: next.accent ?? previous?.accent,
    gtkTheme: next.gtkTheme ?? previous?.gtkTheme,
    windowButtonLayout: next.windowButtonLayout ?? previous?.windowButtonLayout,
    iconTheme: next.iconTheme ?? previous?.iconTheme,
    cursorTheme: next.cursorTheme ?? previous?.cursorTheme,
    fontName: next.fontName ?? previous?.fontName,
    textScale: next.textScale ?? previous?.textScale,
    source: next.source?.length ? next.source : previous?.source,
  };
}

function hasThemeSignal(snapshot: LinuxDesktopThemeSnapshot): boolean {
  return Boolean(
    snapshot.scheme ||
      snapshot.accent ||
      snapshot.gtkTheme ||
      snapshot.windowButtonLayout ||
      snapshot.iconTheme ||
      snapshot.cursorTheme ||
      snapshot.fontName ||
      snapshot.textScale,
  );
}

function normalizeWindowButtonLayout(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 128) return null;
  return normalized;
}

function normalizeScheme(
  value: LinuxDesktopThemeSnapshot["scheme"],
): "dark" | "light" | null {
  if (value !== "dark" && value !== "light") return null;
  return value;
}

function normalizeHexColor(value: string | null | undefined): string | null {
  if (!value || !HEX_COLOR_RE.test(value)) return null;
  return value.toLowerCase();
}

function fontFamilyFromGtkFont(
  value: string | null | undefined,
): string | null {
  const family = value?.trim().replace(GTK_FONT_SIZE_SUFFIX_RE, "").trim();
  if (!family) return null;
  return `"${family.replace(
    CSS_STRING_ESCAPE_RE,
    "\\$&",
  )}", system-ui, sans-serif`;
}

function setCssProperty(
  root: HTMLElement,
  name: string,
  value: string | null,
): void {
  if (value) {
    root.style.setProperty(name, value);
  } else {
    root.style.removeProperty(name);
  }
}
