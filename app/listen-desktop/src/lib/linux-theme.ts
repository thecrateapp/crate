type LinuxDesktopThemeSnapshot = {
  scheme?: "dark" | "light" | string | null;
  accent?: string | null;
  gtkTheme?: string | null;
  iconTheme?: string | null;
  cursorTheme?: string | null;
  fontName?: string | null;
  textScale?: number | null;
  source?: string[] | null;
};

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const GTK_FONT_SIZE_SUFFIX_RE = /\s+\d+(?:\.\d+)?$/;
const CSS_STRING_ESCAPE_RE = /["\\]/g;

let initialized = false;

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
  return typeof navigator !== "undefined" && /\bLinux\b/i.test(navigator.userAgent);
}

async function refreshLinuxDesktopTheme(): Promise<void> {
  try {
    const snapshot =
      await window.__crateTauriInvoke?.<LinuxDesktopThemeSnapshot | null>(
        "linux_desktop_theme_snapshot",
      );
    applyLinuxDesktopTheme(snapshot ?? null);
  } catch (err) {
    console.warn("[tauri] linux theme bridge failed", err);
  }
}

function applyLinuxDesktopTheme(
  snapshot: LinuxDesktopThemeSnapshot | null,
): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  if (!snapshot || !hasThemeSignal(snapshot)) {
    delete root.dataset.crateLinuxTheme;
    delete root.dataset.crateLinuxScheme;
    root.style.removeProperty("--crate-linux-accent");
    root.style.removeProperty("--crate-linux-font-family");
    return;
  }

  const scheme = normalizeScheme(snapshot.scheme);
  const accent = normalizeHexColor(snapshot.accent);
  const fontFamily = fontFamilyFromGtkFont(snapshot.fontName);

  root.dataset.crateLinuxTheme = "true";
  if (scheme) {
    root.dataset.crateLinuxScheme = scheme;
  } else {
    delete root.dataset.crateLinuxScheme;
  }

  setCssProperty(root, "--crate-linux-accent", accent);
  setCssProperty(root, "--crate-linux-font-family", fontFamily);
}

function hasThemeSignal(snapshot: LinuxDesktopThemeSnapshot): boolean {
  return Boolean(
    snapshot.scheme ||
      snapshot.accent ||
      snapshot.gtkTheme ||
      snapshot.iconTheme ||
      snapshot.cursorTheme ||
      snapshot.fontName ||
      snapshot.textScale,
  );
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

function fontFamilyFromGtkFont(value: string | null | undefined): string | null {
  const family = value?.trim().replace(GTK_FONT_SIZE_SUFFIX_RE, "").trim();
  if (!family) return null;
  return `"${family.replace(CSS_STRING_ESCAPE_RE, "\\$&")}", system-ui, sans-serif`;
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
