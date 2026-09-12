import {
  applyAppearanceToRoot,
  createDefaultAppearancePreferences,
  inspectAppearancePreferences,
  readAppearancePreferences,
  resolveAppearance,
  writeAppearancePreferences,
} from "./appearance-resolver";
import {
  APPEARANCE_OPTION_VALUES,
  APPEARANCE_PRESET_REGISTRY,
  APPEARANCE_TOKEN_REGISTRY,
  APPEARANCE_VARIABLE_ALLOWLIST,
} from "./appearance-token-registry";
import type {
  AppearanceStorage,
  ColorModePreference as AppearanceColorModePreference,
  PresetId,
  ResolvedColorMode as AppearanceResolvedColorMode,
} from "./appearance-types";

export const THEME_SKIN_STORAGE_KEY = "crate.listen.theme-skin";

export const MODE_REGISTRY = Object.fromEntries(
  APPEARANCE_OPTION_VALUES.mode.map((id) => [
    id,
    { id, colorScheme: id === "system" ? "dark light" : id },
  ]),
) as Record<
  AppearanceColorModePreference,
  { id: AppearanceColorModePreference; colorScheme: string }
>;

export const SKIN_VARIABLE_ALLOWLIST = APPEARANCE_VARIABLE_ALLOWLIST;

type SkinVariables = Record<string, string>;

interface SkinDefinition {
  id: PresetId;
  modes: Record<AppearanceResolvedColorMode, SkinVariables>;
}

function defaultSkinVariables(
  preset: PresetId,
  mode: AppearanceResolvedColorMode,
): SkinVariables {
  return Object.fromEntries(
    APPEARANCE_VARIABLE_ALLOWLIST.map((name) => [
      name,
      APPEARANCE_TOKEN_REGISTRY[name]!.defaults[preset][mode],
    ]),
  );
}

export const SKIN_REGISTRY = Object.fromEntries(
  (Object.keys(APPEARANCE_PRESET_REGISTRY) as PresetId[]).map((preset) => [
    preset,
    {
      id: preset,
      modes: {
        dark: defaultSkinVariables(preset, "dark"),
        light: defaultSkinVariables(preset, "light"),
      },
    } satisfies SkinDefinition,
  ]),
) as Record<PresetId, SkinDefinition>;
export type ColorModePreference = AppearanceColorModePreference;
export type ResolvedColorMode = AppearanceResolvedColorMode;
export type SkinId = PresetId;

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

const THEME_SKIN_CHANGE_EVENT = "crate:theme-skin-change";
let currentThemeSkin: AppliedThemeSkinSelection = {
  ...DEFAULT_THEME_SKIN,
  resolvedMode: "dark",
};

export function getAppliedThemeSkin(): AppliedThemeSkinSelection {
  return currentThemeSkin;
}

export function subscribeThemeSkin(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  window.addEventListener(THEME_SKIN_CHANGE_EVENT, listener);
  return () => window.removeEventListener(THEME_SKIN_CHANGE_EVENT, listener);
}

function publishThemeSkin(selection: AppliedThemeSkinSelection): void {
  currentThemeSkin = selection;

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(THEME_SKIN_CHANGE_EVENT));
  }
}

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;
type MatchMedia = (query: string) => MediaQueryList;

interface ThemeSkinOptions {
  root?: HTMLElement;
  storage?: StorageReader & Partial<StorageWriter>;
  matchMedia?: MatchMedia;
  persist?: boolean;
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
    const inspected = inspectAppearancePreferences(storage);
    if (inspected.status !== "corrupt") {
      return {
        mode: inspected.preferences.mode,
        skin: inspected.preferences.preset,
      };
    }

    // Keep the legacy reader tolerant for callers that passed a storage
    // adapter returning the old payload regardless of the requested key.
    const legacyCandidate = inspected.raw
      ? JSON.parse(inspected.raw)
      : undefined;
    if (legacyCandidate && typeof legacyCandidate === "object") {
      return migrateStoredSelection(
        legacyCandidate as {
          mode?: unknown;
          skin?: unknown;
          theme?: unknown;
        },
      );
    }

    return DEFAULT_THEME_SKIN;
  } catch {
    return DEFAULT_THEME_SKIN;
  }
}

const systemListenerCleanup = new WeakMap<HTMLElement, () => void>();
const runtimeAppearanceCleanup = new WeakMap<HTMLElement, () => void>();

function clearSystemListener(root: HTMLElement): void {
  systemListenerCleanup.get(root)?.();
  systemListenerCleanup.delete(root);
}

function clearRuntimeAppearance(root: HTMLElement): void {
  runtimeAppearanceCleanup.get(root)?.();
  runtimeAppearanceCleanup.delete(root);
}

function applyRuntimeAppearance(
  root: HTMLElement,
  selection: ThemeSkinSelection,
  resolvedMode: ResolvedColorMode,
  prefersReducedMotion: boolean,
  storage: ThemeSkinOptions["storage"],
): void {
  clearRuntimeAppearance(root);

  const storedPreferences = storage?.getItem
    ? readAppearancePreferences(storage)
    : createDefaultAppearancePreferences();
  const appearance = resolveAppearance(
    {
      ...storedPreferences,
      mode: selection.mode,
      preset: selection.skin,
    },
    {
      prefersColorSchemeDark: resolvedMode === "dark",
      prefersReducedMotion,
    },
  );

  runtimeAppearanceCleanup.set(root, applyAppearanceToRoot(root, appearance));
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
  const reducedMotionQuery = matchMedia?.("(prefers-reduced-motion: reduce)");
  const storage = options.storage ?? getBrowserStorage();
  const resolvedMode = resolveColorMode(
    selection.mode,
    mediaQuery?.matches ?? true,
  );

  if (root) {
    clearSystemListener(root);
    clearRuntimeAppearance(root);
    root.dataset.crateApp = "listen";
    root.dataset.crateMode = resolvedMode;
    root.dataset.crateModePreference = selection.mode;
    root.dataset.crateSkin = selection.skin;
    root.style.colorScheme = MODE_REGISTRY[resolvedMode].colorScheme;
    applyRuntimeAppearance(
      root,
      selection,
      resolvedMode,
      reducedMotionQuery?.matches ?? false,
      storage,
    );

    if (selection.mode === "system" && mediaQuery) {
      const onChange = (event: MediaQueryListEvent) => {
        const nextMode = event.matches ? "dark" : "light";
        root.dataset.crateMode = nextMode;
        root.style.colorScheme = MODE_REGISTRY[nextMode].colorScheme;
        applyRuntimeAppearance(
          root,
          selection,
          nextMode,
          reducedMotionQuery?.matches ?? false,
          storage,
        );
        publishThemeSkin({
          ...selection,
          resolvedMode: nextMode,
        });
      };

      mediaQuery.addEventListener("change", onChange);
      systemListenerCleanup.set(root, () =>
        mediaQuery.removeEventListener("change", onChange),
      );
    }
  }

  if (options.persist !== false && storage?.getItem && storage.setItem) {
    const preferences = readAppearancePreferences(storage);
    writeAppearancePreferences(storage as AppearanceStorage, {
      ...preferences,
      mode: selection.mode,
      preset: selection.skin,
    });
  } else if (options.persist !== false) {
    try {
      storage?.setItem?.(
        THEME_SKIN_STORAGE_KEY,
        JSON.stringify({ mode: selection.mode, skin: selection.skin }),
      );
    } catch {
      // Persistence is best effort; the active selection still applies.
    }
  }

  const appliedSelection = { ...selection, resolvedMode };
  publishThemeSkin(appliedSelection);
  return appliedSelection;
}

export function initializeThemeSkin(
  options: ThemeSkinOptions = {},
): AppliedThemeSkinSelection {
  const storage = options.storage ?? getBrowserStorage();
  const stored = readStoredThemeSkin(storage);
  const status = storage
    ? inspectAppearancePreferences(storage).status
    : "default";

  return applyThemeSkin(stored.mode, stored.skin, {
    ...options,
    storage,
    persist: status === "legacy",
  });
}
