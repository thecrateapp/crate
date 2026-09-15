import {
  APPEARANCE_CORRUPT_BACKUP_STORAGE_KEY,
  APPEARANCE_LEGACY_BACKUP_STORAGE_KEY,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_PREFERENCES,
  LEGACY_THEME_SKIN_STORAGE_KEY,
  type AccentId,
  type AppearanceEnvironment,
  type AppearanceOverrides,
  type AppearancePreferencesV2,
  type AppearanceReadResult,
  type AppearanceResolution,
  type AppearanceStorage,
  type AppearanceWriteResult,
  type ColorModePreference,
  type ContentDensity,
  type Effects,
  type Material,
  type MotionPreference,
  type PresetId,
  type Radius,
  type StorageReader,
  type SurfaceTone,
  type Typography,
} from "./appearance-types";
import {
  chooseAccessibleForeground,
  contrastRatioComposited,
  DEFAULT_DARK_FOREGROUND,
} from "./color-contrast";
import {
  APPEARANCE_OPTION_VALUES,
  APPEARANCE_PRESET_REGISTRY,
  getAppearanceAccentColor,
  getAppearanceDangerColor,
  getAppearanceSurfaceColors,
  resolveAppearanceVariables,
} from "./appearance-token-registry";

export {
  APPEARANCE_CORRUPT_BACKUP_STORAGE_KEY,
  APPEARANCE_LEGACY_BACKUP_STORAGE_KEY,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_PREFERENCES,
  LEGACY_THEME_SKIN_STORAGE_KEY,
  createDefaultAppearancePreferences,
} from "./appearance-types";
export type {
  AccentId,
  AppearanceEffectiveValues,
  AppearanceEnvironment,
  AppearanceOverrides,
  AppearancePreferencesV2,
  AppearanceReadResult,
  AppearanceResolution,
  AppearanceStorage,
  AppearanceWriteResult,
  ColorModePreference,
  ContentDensity,
  Effects,
  Material,
  MotionPreference,
  PresetId,
  Radius,
  StorageReader,
  SurfaceTone,
  Typography,
} from "./appearance-types";

export interface AppearanceContrastIssue {
  token: string;
  ratio: number | null;
  minimum: number;
}

export interface AppearanceContrastReport {
  valid: boolean;
  issues: AppearanceContrastIssue[];
}

const ACCENTS = new Set<AccentId>(APPEARANCE_OPTION_VALUES.accent);
const SURFACE_TONES = new Set<SurfaceTone>(
  APPEARANCE_OPTION_VALUES.surfaceTone,
);
const MATERIALS = new Set<Material>(APPEARANCE_OPTION_VALUES.material);
const RADII = new Set<Radius>(APPEARANCE_OPTION_VALUES.radius);
const TYPOGRAPHIES = new Set<Typography>(APPEARANCE_OPTION_VALUES.typography);
const EFFECTS = new Set<Effects>(APPEARANCE_OPTION_VALUES.effects);
const MODES = new Set<ColorModePreference>(APPEARANCE_OPTION_VALUES.mode);
const PRESETS = new Set<PresetId>(
  Object.keys(APPEARANCE_PRESET_REGISTRY) as PresetId[],
);
const DENSITIES = new Set<ContentDensity>(APPEARANCE_OPTION_VALUES.density);
const MOTIONS = new Set<MotionPreference>(APPEARANCE_OPTION_VALUES.motion);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick<T>(value: unknown, values: Set<T>, fallback: T): T {
  return values.has(value as T) ? (value as T) : fallback;
}

function normalizeOverrides(value: unknown): AppearanceOverrides {
  if (!isRecord(value)) return {};

  const overrides: AppearanceOverrides = {};
  if (ACCENTS.has(value.accent as AccentId))
    overrides.accent = value.accent as AccentId;
  if (SURFACE_TONES.has(value.surfaceTone as SurfaceTone)) {
    overrides.surfaceTone = value.surfaceTone as SurfaceTone;
  }
  if (MATERIALS.has(value.material as Material))
    overrides.material = value.material as Material;
  if (RADII.has(value.radius as Radius))
    overrides.radius = value.radius as Radius;
  if (TYPOGRAPHIES.has(value.typography as Typography)) {
    overrides.typography = value.typography as Typography;
  }
  if (EFFECTS.has(value.effects as Effects))
    overrides.effects = value.effects as Effects;
  return overrides;
}

export function normalizeAppearancePreferences(
  value: unknown,
): AppearancePreferencesV2 {
  const record = isRecord(value) ? value : {};
  const mode = pick(record.mode, MODES, DEFAULT_APPEARANCE_PREFERENCES.mode);
  const preset = pick(
    record.preset,
    PRESETS,
    DEFAULT_APPEARANCE_PREFERENCES.preset,
  );
  const presentation = isRecord(record.presentation) ? record.presentation : {};
  const accessibility = isRecord(record.accessibility)
    ? record.accessibility
    : {};

  return {
    version: 2,
    mode,
    preset,
    overrides: normalizeOverrides(record.overrides),
    presentation: {
      density: pick(
        presentation.density,
        DENSITIES,
        DEFAULT_APPEARANCE_PREFERENCES.presentation.density,
      ),
    },
    accessibility: {
      motion: pick(
        accessibility.motion,
        MOTIONS,
        DEFAULT_APPEARANCE_PREFERENCES.accessibility.motion,
      ),
    },
  };
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isFutureVersion(value: unknown): boolean {
  return (
    isRecord(value) && typeof value.version === "number" && value.version > 2
  );
}

function parseLegacyPreferences(
  value: unknown,
): AppearancePreferencesV2 | undefined {
  if (!isRecord(value)) return undefined;
  const mode = value.mode ?? value.theme;
  if (mode !== "dark" && mode !== "light" && mode !== "system")
    return undefined;

  const preset = value.skin === "aurora" ? "crateRed" : value.skin;
  return normalizeAppearancePreferences({ mode, preset });
}

export function inspectAppearancePreferences(
  storage: StorageReader,
): AppearanceReadResult {
  const v2Raw = storage.getItem(APPEARANCE_STORAGE_KEY);
  if (v2Raw !== null) {
    const parsed = parseJson(v2Raw);
    if (isFutureVersion(parsed)) {
      return {
        preferences: normalizeAppearancePreferences(undefined),
        status: "future-version",
        raw: v2Raw,
      };
    }
    if (isRecord(parsed) && parsed.version === 2) {
      return {
        preferences: normalizeAppearancePreferences(parsed),
        status: "valid",
        raw: v2Raw,
      };
    }
    return {
      preferences: normalizeAppearancePreferences(undefined),
      status: "corrupt",
      raw: v2Raw,
    };
  }

  const legacyRaw = storage.getItem(LEGACY_THEME_SKIN_STORAGE_KEY);
  const legacy = parseLegacyPreferences(parseJson(legacyRaw));
  if (legacy)
    return {
      preferences: legacy,
      status: "legacy",
      raw: legacyRaw ?? undefined,
    };

  return {
    preferences: normalizeAppearancePreferences(undefined),
    status: "default",
  };
}

export function readAppearancePreferences(
  storage: StorageReader,
): AppearancePreferencesV2 {
  return inspectAppearancePreferences(storage).preferences;
}

function safeSet(
  storage: AppearanceStorage,
  key: string,
  value: string,
): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function writeAppearancePreferences(
  storage: AppearanceStorage,
  preferences: AppearancePreferencesV2,
): AppearanceWriteResult {
  const current = inspectAppearancePreferences(storage);
  if (current.status === "future-version") {
    return {
      status: "future-version",
      v2Saved: false,
      legacyProjected: false,
      backupSaved: false,
    };
  }

  let backupSaved = false;
  if (current.status === "corrupt" && current.raw) {
    backupSaved = safeSet(
      storage,
      APPEARANCE_CORRUPT_BACKUP_STORAGE_KEY,
      current.raw,
    );
    if (!backupSaved) {
      return {
        status: "backup-failed",
        v2Saved: false,
        legacyProjected: false,
        backupSaved: false,
      };
    }
  } else if (current.status === "legacy" && current.raw) {
    const existingBackup = storage.getItem(
      APPEARANCE_LEGACY_BACKUP_STORAGE_KEY,
    );
    if (existingBackup === null) {
      backupSaved = safeSet(
        storage,
        APPEARANCE_LEGACY_BACKUP_STORAGE_KEY,
        current.raw,
      );
      if (!backupSaved) {
        return {
          status: "backup-failed",
          v2Saved: false,
          legacyProjected: false,
          backupSaved: false,
        };
      }
    } else {
      backupSaved = true;
    }
  }

  const normalized = normalizeAppearancePreferences(preferences);
  const existing =
    current.status === "valid" ? parseJson(current.raw ?? null) : undefined;
  const payload = {
    ...(isRecord(existing) ? existing : {}),
    ...normalized,
  };

  if (!safeSet(storage, APPEARANCE_STORAGE_KEY, JSON.stringify(payload))) {
    return {
      status: "primary-failed",
      v2Saved: false,
      legacyProjected: false,
      backupSaved,
    };
  }

  const legacyProjected = safeSet(
    storage,
    LEGACY_THEME_SKIN_STORAGE_KEY,
    JSON.stringify({ mode: normalized.mode, skin: normalized.preset }),
  );

  return {
    status: legacyProjected ? "saved" : "legacy-projection-failed",
    v2Saved: true,
    legacyProjected,
    backupSaved,
  };
}

export function resolveAppearance(
  preferences: AppearancePreferencesV2,
  environment: AppearanceEnvironment,
): AppearanceResolution {
  const normalized = normalizeAppearancePreferences(preferences);
  const mode =
    normalized.mode === "system"
      ? environment.prefersColorSchemeDark
        ? "dark"
        : "light"
      : normalized.mode;
  const effective = {
    ...APPEARANCE_PRESET_REGISTRY[normalized.preset].defaults,
    ...normalized.overrides,
  };

  return {
    mode,
    preset: normalized.preset,
    preferences: normalized,
    effective,
    density: normalized.presentation.density,
    motion: normalized.accessibility.motion,
    reducedMotion:
      normalized.accessibility.motion === "reduced" ||
      environment.prefersReducedMotion,
  };
}

function accentColorFor(appearance: AppearanceResolution): string {
  return getAppearanceAccentColor(appearance);
}

export function resolveAccentForeground(
  appearance: AppearanceResolution,
): string {
  return (
    chooseAccessibleForeground(accentColorFor(appearance)) ??
    DEFAULT_DARK_FOREGROUND
  );
}

function dangerColorFor(appearance: AppearanceResolution): string {
  return getAppearanceDangerColor(appearance);
}

export function resolveDangerForeground(
  appearance: AppearanceResolution,
): string {
  return (
    chooseAccessibleForeground(dangerColorFor(appearance)) ??
    DEFAULT_DARK_FOREGROUND
  );
}

export function validateAppearanceContrast(
  appearance: AppearanceResolution,
): AppearanceContrastReport {
  const palette = getAppearanceSurfaceColors(appearance);
  const appSurface = palette["--crate-token-surface-app"]!;
  const solidSurface = palette["--crate-token-surface-card-solid"]!;
  const glassSurface = palette["--crate-token-surface-card-glass"]!;
  const surface =
    appearance.effective.material === "glass" ? glassSurface : solidSurface;
  const foreground = palette["--crate-token-color-foreground"]!;
  const accent = accentColorFor(appearance);
  const checks = [
    {
      token: "text-on-surface",
      ratio: contrastRatioComposited(foreground, surface, appSurface),
      minimum: 4.5,
    },
    {
      token: "accent-control",
      ratio: contrastRatioComposited(
        resolveAccentForeground(appearance),
        accent,
      ),
      minimum: 4.5,
    },
    {
      token: "focus-ring",
      ratio: contrastRatioComposited(accent, appSurface),
      minimum: 3,
    },
    {
      token: "danger-control",
      ratio: contrastRatioComposited(
        resolveDangerForeground(appearance),
        dangerColorFor(appearance),
      ),
      minimum: 4.5,
    },
  ];
  const issues = checks.filter(
    ({ ratio, minimum }) => ratio === null || ratio < minimum,
  );

  return { valid: issues.length === 0, issues };
}

const SCOPE_ATTRIBUTES = [
  "crateMode",
  "crateModePreference",
  "crateSkin",
  "crateEffects",
  "crateMotion",
  "crateDensity",
  "crateSurfaceTone",
  "surface",
] as const;

export function applyAppearanceToRoot(
  root: HTMLElement,
  appearance: AppearanceResolution,
): () => void {
  const variables = resolveAppearanceVariables(appearance);
  const previousVariables = new Map<string, [string, string]>();
  Object.keys(variables).forEach((name) => {
    previousVariables.set(name, [
      root.style.getPropertyValue(name),
      root.style.getPropertyPriority(name),
    ]);
    root.style.setProperty(name, variables[name]!);
  });

  const previousAttributes = new Map<string, string | null>();
  SCOPE_ATTRIBUTES.forEach((attribute) => {
    previousAttributes.set(attribute, root.dataset[attribute] ?? null);
  });
  root.dataset.crateMode = appearance.mode;
  root.dataset.crateModePreference = appearance.preferences.mode;
  root.dataset.crateSkin = appearance.preset;
  root.dataset.crateEffects = appearance.effective.effects;
  root.dataset.crateMotion = appearance.reducedMotion ? "reduced" : "system";
  root.dataset.crateDensity = appearance.density;
  root.dataset.crateSurfaceTone = appearance.effective.surfaceTone;
  root.dataset.surface = appearance.effective.material;

  const previousColorScheme = root.style.colorScheme;
  root.style.colorScheme = appearance.mode;

  return () => {
    previousVariables.forEach(([value, priority], name) => {
      if (value) root.style.setProperty(name, value, priority);
      else root.style.removeProperty(name);
    });
    SCOPE_ATTRIBUTES.forEach((attribute) => {
      const value = previousAttributes.get(attribute);
      if (value === null || value === undefined) delete root.dataset[attribute];
      else root.dataset[attribute] = value;
    });
    root.style.colorScheme = previousColorScheme;
  };
}
