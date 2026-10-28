export type ContentDensity = "comfortable" | "compact";
export type MotionPreference = "system" | "reduced";
export type Effects = "off" | "subtle" | "expressive";

export interface UiPreferences {
  version: 1;
  density: ContentDensity;
  motion: MotionPreference;
  effects: Effects;
}

export const UI_PREFERENCES_STORAGE_KEY = "crate.interface-preferences.v1";
export const DEFAULT_UI_PREFERENCES: Readonly<UiPreferences> = Object.freeze({
  version: 1,
  density: "comfortable",
  motion: "system",
  effects: "subtle",
});

const LEGACY_KEYS = [
  "crate.listen.appearance.v2",
  "crate.listen.theme-skin",
  "crate.listen.theme-skin.backup.v1",
  "crate.listen.appearance.corrupt-backup",
] as const;

type StorageReader = Pick<Storage, "getItem">;
type PreferenceStorage = StorageReader &
  Pick<Storage, "setItem" | "removeItem">;
type MatchMedia = (query: string) => MediaQueryList;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStored(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function futureVersion(value: unknown, supported: number): boolean {
  return (
    isRecord(value) &&
    typeof value.version === "number" &&
    value.version > supported
  );
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function normalizeUiPreferences(value: unknown): UiPreferences {
  const input = isRecord(value) ? value : {};
  return {
    version: 1,
    density: input.density === "compact" ? "compact" : "comfortable",
    motion: input.motion === "reduced" ? "reduced" : "system",
    effects:
      input.effects === "off" || input.effects === "expressive"
        ? input.effects
        : "subtle",
  };
}

function inspectPreferences(storage: StorageReader | undefined): {
  preferences: UiPreferences;
  current: boolean;
  protected: boolean;
} {
  if (!storage)
    return {
      preferences: normalizeUiPreferences(undefined),
      current: false,
      protected: true,
    };
  try {
    const primary = parseStored(storage.getItem(UI_PREFERENCES_STORAGE_KEY));
    if (futureVersion(primary, 1))
      return {
        preferences: normalizeUiPreferences(undefined),
        current: false,
        protected: true,
      };
    if (isRecord(primary) && primary.version === 1) {
      return {
        preferences: normalizeUiPreferences(primary),
        current: true,
        protected: false,
      };
    }
    const legacy = parseStored(storage.getItem(LEGACY_KEYS[0]));
    if (isRecord(legacy) && legacy.version === 2) {
      const presentation = isRecord(legacy.presentation)
        ? legacy.presentation
        : {};
      const accessibility = isRecord(legacy.accessibility)
        ? legacy.accessibility
        : {};
      const overrides = isRecord(legacy.overrides) ? legacy.overrides : {};
      return {
        preferences: normalizeUiPreferences({
          density: presentation.density,
          motion: accessibility.motion,
          effects: overrides.effects,
        }),
        current: false,
        protected: false,
      };
    }
    return {
      preferences: normalizeUiPreferences(undefined),
      current: false,
      protected: false,
    };
  } catch {
    return {
      preferences: normalizeUiPreferences(undefined),
      current: false,
      protected: true,
    };
  }
}

export function readUiPreferences(
  storage: StorageReader | undefined = browserStorage(),
): UiPreferences {
  return inspectPreferences(storage).preferences;
}

export function migrateUiPreferences(
  storage: PreferenceStorage,
): UiPreferences {
  const inspected = inspectPreferences(storage);
  if (inspected.protected) return inspected.preferences;

  try {
    const legacy = LEGACY_KEYS.map(
      (key) => [key, storage.getItem(key)] as const,
    );
    const preserveLegacy = legacy.some(([, raw]) =>
      futureVersion(parseStored(raw), 2),
    );
    if (!inspected.current)
      storage.setItem(
        UI_PREFERENCES_STORAGE_KEY,
        JSON.stringify(inspected.preferences),
      );
    if (!preserveLegacy) {
      for (const [key, raw] of legacy) {
        if (raw !== null) storage.removeItem(key);
      }
    }
  } catch {
    // A failed destination write leaves every source intact; cleanup can retry later.
  }
  return inspected.preferences;
}

let currentPreferences: UiPreferences = DEFAULT_UI_PREFERENCES;
let activeRoot: HTMLElement | undefined;
let activeStorage: PreferenceStorage | undefined;
let activeMediaQuery: MediaQueryList | undefined;
let activeCleanup: (() => void) | undefined;
const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of listeners) listener();
}

function applyPreferences(): void {
  if (!activeRoot) return;
  activeRoot.dataset.crateDensity = currentPreferences.density;
  activeRoot.dataset.crateMotion =
    currentPreferences.motion === "reduced" || activeMediaQuery?.matches
      ? "reduced"
      : "system";
  activeRoot.dataset.crateEffects = currentPreferences.effects;
}

function updatePreferences(preferences: UiPreferences): void {
  const changed =
    preferences.density !== currentPreferences.density ||
    preferences.motion !== currentPreferences.motion ||
    preferences.effects !== currentPreferences.effects;
  if (changed) currentPreferences = Object.freeze(preferences);
  applyPreferences();
  if (changed) publish();
}

export function getUiPreferences(): UiPreferences {
  return currentPreferences;
}

export function subscribeUiPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setUiPreferences(
  patch: Partial<Omit<UiPreferences, "version">>,
): boolean {
  const next = normalizeUiPreferences({ ...currentPreferences, ...patch });
  updatePreferences(next);
  const storage = activeStorage ?? browserStorage();
  if (!storage) return false;
  try {
    if (
      futureVersion(parseStored(storage.getItem(UI_PREFERENCES_STORAGE_KEY)), 1)
    )
      return false;
    storage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function initializeUiPreferences(
  options: {
    root?: HTMLElement;
    storage?: Storage;
    matchMedia?: MatchMedia;
  } = {},
): () => void {
  activeCleanup?.();
  activeRoot =
    options.root ??
    (typeof document === "undefined" ? undefined : document.documentElement);
  activeStorage = options.storage ?? browserStorage();
  const view =
    activeRoot?.ownerDocument.defaultView ??
    (typeof window === "undefined" ? undefined : window);
  const matchMedia = options.matchMedia ?? view?.matchMedia?.bind(view);
  activeMediaQuery = matchMedia?.("(prefers-reduced-motion: reduce)");
  updatePreferences(
    activeStorage
      ? migrateUiPreferences(activeStorage)
      : normalizeUiPreferences(undefined),
  );

  const media = activeMediaQuery;
  const onMotionChange = () => {
    applyPreferences();
    publish();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== UI_PREFERENCES_STORAGE_KEY) return;
    if (event.storageArea !== null && event.storageArea !== activeStorage)
      return;
    updatePreferences(readUiPreferences(activeStorage));
  };
  media?.addEventListener("change", onMotionChange);
  view?.addEventListener("storage", onStorage);
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    media?.removeEventListener("change", onMotionChange);
    view?.removeEventListener("storage", onStorage);
    if (activeCleanup === cleanup) {
      activeCleanup = undefined;
      activeRoot = undefined;
      activeStorage = undefined;
      activeMediaQuery = undefined;
    }
  };
  activeCleanup = cleanup;
  return cleanup;
}
