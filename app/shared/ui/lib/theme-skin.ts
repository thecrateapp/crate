export const THEME_SKIN_STORAGE_KEY = "crate.listen.theme-skin";

export const THEME_REGISTRY = {
  dark: {
    id: "dark",
    label: "Dark",
    colorScheme: "dark",
  },
  "high-contrast": {
    id: "high-contrast",
    label: "High contrast",
    colorScheme: "dark",
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

interface SkinDefinition {
  id: string;
  label: string;
  variables: Partial<Record<SkinVariableName, string>>;
}

const DEFAULT_SKIN_VARIABLES: Partial<Record<SkinVariableName, string>> = {};

export const SKIN_REGISTRY = {
  default: {
    id: "default",
    label: "Default",
    variables: DEFAULT_SKIN_VARIABLES,
  },
  aurora: {
    id: "aurora",
    label: "Aurora",
    variables: {
      "--color-primary": "#a78bfa",
      "--color-primary-foreground": "#1e1b4b",
      "--color-foreground": "#f5f3ff",
      "--color-muted-foreground": "#a5b4fc",
      "--color-border": "#302e4a",
      "--surface-app": "#080711",
      "--surface-panel": "#11101e",
      "--surface-raised": "#19162b",
      "--surface-modal": "rgba(17, 16, 30, 0.96)",
    },
  },
} as const satisfies Record<string, SkinDefinition>;

export type ThemeId = keyof typeof THEME_REGISTRY;
export type SkinId = keyof typeof SKIN_REGISTRY;

const SUPPORTED_COMBINATIONS = new Set([
  "dark:default",
  "dark:aurora",
  "high-contrast:default",
]);

export interface ThemeSkinSelection {
  theme: ThemeId;
  skin: SkinId;
}

export const DEFAULT_THEME_SKIN = {
  theme: "dark",
  skin: "default",
} as const satisfies ThemeSkinSelection;

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

interface ThemeSkinOptions {
  root?: HTMLElement;
  storage?: StorageReader & Partial<StorageWriter>;
}

function getBrowserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(THEME_REGISTRY, value)
  );
}

function isSkinId(value: unknown): value is SkinId {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SKIN_REGISTRY, value)
  );
}

export function resolveThemeSkin(
  theme: unknown,
  skin: unknown,
): ThemeSkinSelection {
  const resolvedTheme = isThemeId(theme) ? theme : DEFAULT_THEME_SKIN.theme;
  const resolvedSkin = isSkinId(skin) ? skin : DEFAULT_THEME_SKIN.skin;

  if (SUPPORTED_COMBINATIONS.has(`${resolvedTheme}:${resolvedSkin}`)) {
    return { theme: resolvedTheme, skin: resolvedSkin };
  }

  if (SUPPORTED_COMBINATIONS.has(`${resolvedTheme}:default`)) {
    return { theme: resolvedTheme, skin: "default" };
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

    const candidate = parsed as { theme?: unknown; skin?: unknown };
    return resolveThemeSkin(candidate.theme, candidate.skin);
  } catch {
    return DEFAULT_THEME_SKIN;
  }
}

function clearAppliedVariables(root: HTMLElement): void {
  const appliedVariables = root.dataset.crateThemeSkinVars
    ?.split(",")
    .filter(Boolean);

  appliedVariables?.forEach((name) => root.style.removeProperty(name));
  delete root.dataset.crateThemeSkinVars;
}

function applySkinVariables(root: HTMLElement, skin: SkinId): void {
  clearAppliedVariables(root);

  const appliedVariables: string[] = [];
  const skinDefinition = SKIN_REGISTRY[skin];
  if (!skinDefinition) return;

  const variables = skinDefinition.variables;

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
  theme: unknown,
  skin: unknown,
  options: ThemeSkinOptions = {},
): ThemeSkinSelection {
  const selection = resolveThemeSkin(theme, skin);
  const root =
    options.root ??
    (typeof document === "undefined" ? undefined : document.documentElement);

  if (root) {
    root.dataset.crateApp = "listen";
    root.dataset.crateTheme = selection.theme;
    root.dataset.crateSkin = selection.skin;
    root.style.colorScheme = THEME_REGISTRY[selection.theme].colorScheme;
    applySkinVariables(root, selection.skin);
  }

  const storage = options.storage ?? getBrowserStorage();
  try {
    storage?.setItem?.(THEME_SKIN_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Persistence is best effort; the active selection still applies.
  }

  return selection;
}

export function initializeThemeSkin(
  options: ThemeSkinOptions = {},
): ThemeSkinSelection {
  const stored = readStoredThemeSkin(options.storage);
  return applyThemeSkin(stored.theme, stored.skin, options);
}
