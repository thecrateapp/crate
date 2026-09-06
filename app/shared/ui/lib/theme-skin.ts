export const THEME_SKIN_STORAGE_KEY = "crate.listen.theme-skin";

export const MODE_REGISTRY = {
  dark: {
    id: "dark",
    colorScheme: "dark",
  },
  light: {
    id: "light",
    colorScheme: "light",
  },
  system: {
    id: "system",
    colorScheme: "dark light",
  },
} as const;

export const SKIN_VARIABLE_ALLOWLIST = [
  "--color-primary",
  "--color-primary-foreground",
  "--color-foreground",
  "--color-muted-foreground",
  "--color-border",
  "--surface-app",
  "--surface-panel",
  "--surface-raised",
  "--surface-modal",
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
  "--radius-xl",
  "--font-brand",
] as const;

type SkinVariableName = (typeof SKIN_VARIABLE_ALLOWLIST)[number];

type SkinVariables = Partial<Record<SkinVariableName, string>>;

interface SkinDefinition {
  id: string;
  modes: Record<ResolvedColorMode, SkinVariables>;
}

const EMPTY_SKIN_VARIABLES: SkinVariables = {};

export const SKIN_REGISTRY = {
  default: {
    id: "default",
    modes: {
      dark: EMPTY_SKIN_VARIABLES,
      light: EMPTY_SKIN_VARIABLES,
    },
  },
  crateRed: {
    id: "crateRed",
    modes: {
      dark: EMPTY_SKIN_VARIABLES,
      light: EMPTY_SKIN_VARIABLES,
    },
  },
} as const satisfies Record<string, SkinDefinition>;

export type ColorModePreference = keyof typeof MODE_REGISTRY;
export type ResolvedColorMode = Exclude<ColorModePreference, "system">;
export type SkinId = keyof typeof SKIN_REGISTRY;

export interface ThemeSkinSelection {
  mode: ColorModePreference;
  skin: SkinId;
}

export interface AppliedThemeSkinSelection extends ThemeSkinSelection {
  resolvedMode: ResolvedColorMode;
}

export const DEFAULT_THEME_SKIN = {
  mode: "dark",
  skin: "default",
} as const satisfies ThemeSkinSelection;

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;
type MatchMedia = (query: string) => MediaQueryList;

interface ThemeSkinOptions {
  root?: HTMLElement;
  storage?: StorageReader & Partial<StorageWriter>;
  matchMedia?: MatchMedia;
}

function getBrowserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function getBrowserMatchMedia(): MatchMedia | undefined {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return undefined;
  }

  return window.matchMedia.bind(window);
}

function isColorModePreference(value: unknown): value is ColorModePreference {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(MODE_REGISTRY, value)
  );
}

function isSkinId(value: unknown): value is SkinId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SKIN_REGISTRY, value)
  );
}

export function resolveColorMode(
  mode: ColorModePreference,
  systemPrefersDark: boolean,
): ResolvedColorMode {
  if (mode === "system") return systemPrefersDark ? "dark" : "light";
  return mode;
}

export function resolveThemeSkin(
  mode: unknown,
  skin: unknown,
): ThemeSkinSelection {
  const resolvedMode = isColorModePreference(mode)
    ? mode
    : DEFAULT_THEME_SKIN.mode;
  const resolvedSkin = isSkinId(skin) ? skin : DEFAULT_THEME_SKIN.skin;

  if (
    resolvedMode === "system" ||
    Object.prototype.hasOwnProperty.call(SKIN_REGISTRY, resolvedSkin)
  ) {
    return { mode: resolvedMode, skin: resolvedSkin };
  }

  return { mode: resolvedMode, skin: DEFAULT_THEME_SKIN.skin };
}

function migrateStoredSelection(candidate: {
  mode?: unknown;
  skin?: unknown;
  theme?: unknown;
}): ThemeSkinSelection {
  if ("mode" in candidate) {
    return resolveThemeSkin(candidate.mode, candidate.skin);
  }

  if (candidate.theme === "dark" || candidate.theme === "light") {
    const migratedSkin =
      candidate.skin === "aurora" ? "crateRed" : candidate.skin;
    return resolveThemeSkin(candidate.theme, migratedSkin);
  }

  return DEFAULT_THEME_SKIN;
}

export function readStoredThemeSkin(
  storage: StorageReader | undefined = getBrowserStorage(),
): ThemeSkinSelection {
  if (!storage) return DEFAULT_THEME_SKIN;

  try {
    const raw = storage.getItem(THEME_SKIN_STORAGE_KEY);
    if (!raw) return DEFAULT_THEME_SKIN;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_THEME_SKIN;

    return migrateStoredSelection(
      parsed as {
        mode?: unknown;
        skin?: unknown;
        theme?: unknown;
      },
    );
  } catch {
    return DEFAULT_THEME_SKIN;
  }
}

const systemListenerCleanup = new WeakMap<HTMLElement, () => void>();

function clearSystemListener(root: HTMLElement): void {
  systemListenerCleanup.get(root)?.();
  systemListenerCleanup.delete(root);
}

function clearAppliedVariables(root: HTMLElement): void {
  const appliedVariables = root.dataset.crateThemeSkinVars
    ?.split(",")
    .filter(Boolean);

  appliedVariables?.forEach((name) => root.style.removeProperty(name));
  delete root.dataset.crateThemeSkinVars;
}

function applySkinVariables(
  root: HTMLElement,
  skin: SkinId,
  mode: ResolvedColorMode,
): void {
  clearAppliedVariables(root);

  const appliedVariables: string[] = [];
  const variables = SKIN_REGISTRY[skin].modes[mode];

  Object.entries(variables).forEach(([name, value]) => {
    if (
      !value ||
      !SKIN_VARIABLE_ALLOWLIST.some((allowed) => allowed === name)
    ) {
      return;
    }

    root.style.setProperty(name, value);
    appliedVariables.push(name);
  });

  if (appliedVariables.length > 0) {
    root.dataset.crateThemeSkinVars = appliedVariables.join(",");
  }
}

export function applyThemeSkin(
  mode: unknown,
  skin: unknown,
  options: ThemeSkinOptions = {},
): AppliedThemeSkinSelection {
  const selection = resolveThemeSkin(mode, skin);
  const root =
    options.root ??
    (typeof document === "undefined" ? undefined : document.documentElement);
  const matchMedia = options.matchMedia ?? getBrowserMatchMedia();
  const mediaQuery = matchMedia?.("(prefers-color-scheme: dark)");
  const resolvedMode = resolveColorMode(
    selection.mode,
    mediaQuery?.matches ?? true,
  );

  if (root) {
    clearSystemListener(root);
    root.dataset.crateApp = "listen";
    root.dataset.crateMode = resolvedMode;
    root.dataset.crateModePreference = selection.mode;
    root.dataset.crateSkin = selection.skin;
    root.style.colorScheme = MODE_REGISTRY[resolvedMode].colorScheme;
    applySkinVariables(root, selection.skin, resolvedMode);

    if (selection.mode === "system" && mediaQuery) {
      const onChange = (event: MediaQueryListEvent) => {
        const nextMode = event.matches ? "dark" : "light";
        root.dataset.crateMode = nextMode;
        root.style.colorScheme = MODE_REGISTRY[nextMode].colorScheme;
        applySkinVariables(root, selection.skin, nextMode);
      };

      mediaQuery.addEventListener("change", onChange);
      systemListenerCleanup.set(root, () =>
        mediaQuery.removeEventListener("change", onChange),
      );
    }
  }

  const storage = options.storage ?? getBrowserStorage();
  try {
    storage?.setItem?.(
      THEME_SKIN_STORAGE_KEY,
      JSON.stringify({ mode: selection.mode, skin: selection.skin }),
    );
  } catch {
    // Persistence is best effort; the active selection still applies.
  }

  return { ...selection, resolvedMode };
}

export function initializeThemeSkin(
  options: ThemeSkinOptions = {},
): AppliedThemeSkinSelection {
  const stored = readStoredThemeSkin(options.storage);
  return applyThemeSkin(stored.mode, stored.skin, options);
}
