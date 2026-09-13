import type {
  AccentId,
  AppearanceEffectiveValues,
  AppearanceResolution,
  ContentDensity,
  Effects,
  Material,
  MotionPreference,
  PresetId,
  Radius,
  ResolvedColorMode,
  SurfaceTone,
  Typography,
} from "./appearance-types";
import {
  chooseAccessibleForeground,
  DEFAULT_DARK_FOREGROUND,
  parseCssColor,
} from "./color-contrast";

export type AppearanceTokenType =
  | "color"
  | "length"
  | "font"
  | "shadow"
  | "gradient";

export interface AppearanceTokenDefinition {
  name: string;
  type: AppearanceTokenType;
  defaults: Record<PresetId, Record<ResolvedColorMode, string>>;
  overrideable: boolean;
  contrastPairs: readonly string[];
  owner: "design-system";
  consumers: readonly string[];
}

interface AppearanceModeDefinition {
  accents: Record<AccentId, string>;
  danger: string;
  surfaces: Record<string, string>;
  extras: {
    textSecondary: string;
    textSubtle: string;
    textFaint: string;
    borderSubtle: string;
    borderQuiet: string;
    borderQuietSubtle: string;
    idleBorder: string;
    idleBackground: string;
    idleText: string;
    idleTextMuted: string;
    idleTextSubtle: string;
    hoverBorder: string;
    hoverBackground: string;
    hoverBackgroundStrong: string;
    glassShadow: string;
  };
}

interface AppearancePresetDefinition {
  id: PresetId;
  defaults: AppearanceEffectiveValues;
  modes: Record<ResolvedColorMode, AppearanceModeDefinition>;
}

export const APPEARANCE_OPTION_VALUES = {
  accent: ["cyan", "red", "violet"],
  surfaceTone: ["neutral", "warm", "tinted"],
  material: ["solid", "glass"],
  radius: ["subtle", "rounded"],
  typography: ["brand", "system"],
  effects: ["off", "subtle", "expressive"],
  mode: ["dark", "light", "system"],
  density: ["comfortable", "compact"],
  motion: ["system", "reduced"],
} as const satisfies {
  accent: readonly AccentId[];
  surfaceTone: readonly SurfaceTone[];
  material: readonly Material[];
  radius: readonly Radius[];
  typography: readonly Typography[];
  effects: readonly Effects[];
  mode: readonly (ResolvedColorMode | "system")[];
  density: readonly ContentDensity[];
  motion: readonly MotionPreference[];
};

const DEFAULT_DARK_SURFACES = {
  "--crate-token-color-background": "#0a0a0f",
  "--crate-token-color-foreground": "#f1f5f9",
  "--crate-token-color-muted-foreground": "#94a3b8",
  "--crate-token-scrollbar-thumb": "#252535",
  "--crate-token-scrollbar-hover": "#353545",
  "--crate-token-surface-app": "#0a0a0f",
  "--crate-token-surface-card-solid": "#16161e",
  "--crate-token-surface-card-foreground-solid": "#f1f5f9",
  "--crate-token-surface-card-glass": "rgba(18, 18, 26, 0.78)",
  "--crate-token-surface-card-foreground-glass": "#f1f5f9",
  "--crate-token-surface-secondary-glass": "rgba(28, 28, 40, 0.88)",
  "--crate-token-surface-secondary-foreground-glass": "#f1f5f9",
  "--crate-token-surface-muted-glass": "rgba(22, 22, 30, 0.72)",
  "--crate-token-surface-accent-glass": "rgba(255, 255, 255, 0.06)",
  "--crate-token-surface-accent-foreground-glass": "#f1f5f9",
  "--crate-token-surface-popover-glass": "rgba(18, 18, 26, 0.95)",
  "--crate-token-surface-popover-foreground-glass": "#f1f5f9",
  "--crate-token-surface-border-glass": "rgba(255, 255, 255, 0.08)",
  "--crate-token-surface-input-glass": "rgba(20, 20, 25, 0.72)",
  "--crate-token-surface-panel-glass": "#0c0c14",
  "--crate-token-surface-raised-glass": "rgba(18, 18, 26, 0.92)",
  "--crate-token-surface-modal-glass": "rgba(16, 16, 24, 0.95)",
  "--crate-token-surface-overlay-glass": "rgba(18, 18, 26, 0.95)",
  "--crate-token-surface-secondary-solid": "#1c1c28",
  "--crate-token-surface-secondary-foreground-solid": "#f1f5f9",
  "--crate-token-surface-muted-solid": "#16161e",
  "--crate-token-surface-accent-solid": "#1c1c28",
  "--crate-token-surface-accent-foreground-solid": "#f1f5f9",
  "--crate-token-surface-popover-solid": "#16161e",
  "--crate-token-surface-popover-foreground-solid": "#f1f5f9",
  "--crate-token-surface-border-solid": "#252535",
  "--crate-token-surface-input-solid": "#141419",
  "--crate-token-surface-overlay-solid": "rgba(18, 18, 26, 0.95)",
  "--crate-token-surface-panel-solid": "#0c0c14",
  "--crate-token-surface-raised-solid": "#12121a",
  "--crate-token-surface-modal-solid": "rgba(16, 16, 24, 0.95)",
};

const DEFAULT_LIGHT_SURFACES = {
  "--crate-token-color-background": "#f8fafc",
  "--crate-token-color-foreground": "#0f172a",
  "--crate-token-color-muted-foreground": "#64748b",
  "--crate-token-scrollbar-thumb": "#cbd5e1",
  "--crate-token-scrollbar-hover": "#94a3b8",
  "--crate-token-surface-app": "#f8fafc",
  "--crate-token-surface-card-solid": "#ffffff",
  "--crate-token-surface-card-foreground-solid": "#0f172a",
  "--crate-token-surface-card-glass": "rgba(255, 255, 255, 0.78)",
  "--crate-token-surface-card-foreground-glass": "#0f172a",
  "--crate-token-surface-secondary-glass": "rgba(241, 245, 249, 0.88)",
  "--crate-token-surface-secondary-foreground-glass": "#0f172a",
  "--crate-token-surface-muted-glass": "rgba(241, 245, 249, 0.72)",
  "--crate-token-surface-accent-glass": "rgba(15, 23, 42, 0.06)",
  "--crate-token-surface-accent-foreground-glass": "#0f172a",
  "--crate-token-surface-popover-glass": "rgba(255, 255, 255, 0.95)",
  "--crate-token-surface-popover-foreground-glass": "#0f172a",
  "--crate-token-surface-border-glass": "rgba(15, 23, 42, 0.08)",
  "--crate-token-surface-input-glass": "rgba(226, 232, 240, 0.72)",
  "--crate-token-surface-panel-glass": "#ffffff",
  "--crate-token-surface-raised-glass": "rgba(241, 245, 249, 0.92)",
  "--crate-token-surface-modal-glass": "rgba(255, 255, 255, 0.96)",
  "--crate-token-surface-overlay-glass": "rgba(255, 255, 255, 0.98)",
  "--crate-token-surface-secondary-solid": "#f1f5f9",
  "--crate-token-surface-secondary-foreground-solid": "#0f172a",
  "--crate-token-surface-muted-solid": "#f1f5f9",
  "--crate-token-surface-accent-solid": "#e2e8f0",
  "--crate-token-surface-accent-foreground-solid": "#0f172a",
  "--crate-token-surface-popover-solid": "#ffffff",
  "--crate-token-surface-popover-foreground-solid": "#0f172a",
  "--crate-token-surface-border-solid": "#cbd5e1",
  "--crate-token-surface-input-solid": "#e2e8f0",
  "--crate-token-surface-overlay-solid": "rgba(255, 255, 255, 0.98)",
  "--crate-token-surface-panel-solid": "#ffffff",
  "--crate-token-surface-raised-solid": "#f1f5f9",
  "--crate-token-surface-modal-solid": "rgba(255, 255, 255, 0.96)",
};

const CRATE_RED_DARK_SURFACES = {
  ...DEFAULT_DARK_SURFACES,
  "--crate-token-color-background": "#1c1c1e",
  "--crate-token-color-foreground": "#f5f5f7",
  "--crate-token-color-muted-foreground": "#a1a1aa",
  "--crate-token-scrollbar-thumb": "#48484a",
  "--crate-token-scrollbar-hover": "#636366",
  "--crate-token-surface-app": "#1c1c1e",
  "--crate-token-surface-card-solid": "#242426",
  "--crate-token-surface-card-foreground-solid": "#f5f5f7",
  "--crate-token-surface-card-glass": "rgba(36, 36, 38, 0.78)",
  "--crate-token-surface-card-foreground-glass": "#f5f5f7",
  "--crate-token-surface-secondary-glass": "rgba(44, 44, 46, 0.88)",
  "--crate-token-surface-secondary-foreground-glass": "#f5f5f7",
  "--crate-token-surface-muted-glass": "rgba(36, 36, 38, 0.72)",
  "--crate-token-surface-accent-foreground-glass": "#f5f5f7",
  "--crate-token-surface-popover-glass": "rgba(44, 44, 46, 0.95)",
  "--crate-token-surface-popover-foreground-glass": "#f5f5f7",
  "--crate-token-surface-input-glass": "rgba(44, 44, 46, 0.72)",
  "--crate-token-surface-panel-glass": "#232326",
  "--crate-token-surface-raised-glass": "rgba(44, 44, 46, 0.92)",
  "--crate-token-surface-modal-glass": "rgba(44, 44, 46, 0.96)",
  "--crate-token-surface-overlay-glass": "rgba(44, 44, 46, 0.98)",
  "--crate-token-surface-secondary-solid": "#2c2c2e",
  "--crate-token-surface-secondary-foreground-solid": "#f5f5f7",
  "--crate-token-surface-muted-solid": "#242426",
  "--crate-token-surface-accent-solid": "#2c2c2e",
  "--crate-token-surface-accent-foreground-solid": "#f5f5f7",
  "--crate-token-surface-popover-solid": "#242426",
  "--crate-token-surface-popover-foreground-solid": "#f5f5f7",
  "--crate-token-surface-border-solid": "#3a3a3c",
  "--crate-token-surface-input-solid": "#2c2c2e",
  "--crate-token-surface-overlay-solid": "rgba(44, 44, 46, 0.98)",
  "--crate-token-surface-panel-solid": "#232326",
  "--crate-token-surface-raised-solid": "#2c2c2e",
  "--crate-token-surface-modal-solid": "rgba(44, 44, 46, 0.96)",
};

const CRATE_RED_LIGHT_SURFACES = {
  ...DEFAULT_LIGHT_SURFACES,
  "--crate-token-color-background": "#f5f5f7",
  "--crate-token-color-foreground": "#1d1d1f",
  "--crate-token-color-muted-foreground": "#6e6e73",
  "--crate-token-scrollbar-thumb": "#d1d1d6",
  "--crate-token-scrollbar-hover": "#aeaeb2",
  "--crate-token-surface-app": "#f5f5f7",
  "--crate-token-surface-card-foreground-solid": "#1d1d1f",
  "--crate-token-surface-card-foreground-glass": "#1d1d1f",
  "--crate-token-surface-secondary-glass": "rgba(242, 242, 247, 0.88)",
  "--crate-token-surface-secondary-foreground-glass": "#1d1d1f",
  "--crate-token-surface-muted-glass": "rgba(242, 242, 247, 0.72)",
  "--crate-token-surface-accent-glass": "rgba(29, 29, 31, 0.06)",
  "--crate-token-surface-accent-foreground-glass": "#1d1d1f",
  "--crate-token-surface-popover-foreground-glass": "#1d1d1f",
  "--crate-token-surface-border-glass": "rgba(29, 29, 31, 0.08)",
  "--crate-token-surface-input-glass": "rgba(229, 229, 234, 0.72)",
  "--crate-token-surface-raised-glass": "rgba(242, 242, 247, 0.92)",
  "--crate-token-surface-secondary-solid": "#f2f2f7",
  "--crate-token-surface-secondary-foreground-solid": "#1d1d1f",
  "--crate-token-surface-muted-solid": "#f2f2f7",
  "--crate-token-surface-accent-solid": "#e5e5ea",
  "--crate-token-surface-accent-foreground-solid": "#1d1d1f",
  "--crate-token-surface-popover-foreground-solid": "#1d1d1f",
  "--crate-token-surface-border-solid": "#d1d1d6",
  "--crate-token-surface-input-solid": "#e5e5ea",
  "--crate-token-surface-raised-solid": "#f2f2f7",
};

const DEFAULT_DARK_EXTRAS: AppearanceModeDefinition["extras"] = {
  textSecondary: "rgba(255, 255, 255, 0.78)",
  textSubtle: "#94a3b8",
  textFaint: "#475569",
  borderSubtle: "#252535",
  borderQuiet: "rgba(255, 255, 255, 0.1)",
  borderQuietSubtle: "rgba(255, 255, 255, 0.06)",
  idleBorder: "rgba(255, 255, 255, 0.06)",
  idleBackground: "rgba(255, 255, 255, 0.02)",
  idleText: "rgba(255, 255, 255, 0.6)",
  idleTextMuted: "rgba(255, 255, 255, 0.45)",
  idleTextSubtle: "rgba(255, 255, 255, 0.35)",
  hoverBorder: "rgba(255, 255, 255, 0.2)",
  hoverBackground: "rgba(255, 255, 255, 0.05)",
  hoverBackgroundStrong: "rgba(255, 255, 255, 0.1)",
  glassShadow: "rgba(0, 0, 0, 0.48)",
};

const DEFAULT_LIGHT_EXTRAS: AppearanceModeDefinition["extras"] = {
  textSecondary: "rgba(15, 23, 42, 0.75)",
  textSubtle: "#475569",
  textFaint: "#94a3b8",
  borderSubtle: "#cbd5e1",
  borderQuiet: "rgba(15, 23, 42, 0.12)",
  borderQuietSubtle: "rgba(15, 23, 42, 0.06)",
  idleBorder: "rgba(15, 23, 42, 0.12)",
  idleBackground: "rgba(15, 23, 42, 0.03)",
  idleText: "rgba(15, 23, 42, 0.7)",
  idleTextMuted: "rgba(15, 23, 42, 0.55)",
  idleTextSubtle: "rgba(15, 23, 42, 0.45)",
  hoverBorder: "rgba(15, 23, 42, 0.2)",
  hoverBackground: "rgba(15, 23, 42, 0.05)",
  hoverBackgroundStrong: "rgba(15, 23, 42, 0.1)",
  glassShadow: "rgba(15, 23, 42, 0.18)",
};

const RADIUS_VALUES: Record<Radius, Record<string, string>> = {
  subtle: {
    "--crate-token-radius-sm": "0.125rem",
    "--crate-token-radius-md": "0.25rem",
    "--crate-token-radius-lg": "0.375rem",
    "--crate-token-radius-xl": "0.5rem",
  },
  rounded: {
    "--crate-token-radius-sm": "0.25rem",
    "--crate-token-radius-md": "0.5rem",
    "--crate-token-radius-lg": "0.75rem",
    "--crate-token-radius-xl": "1rem",
  },
};

const EFFECT_GLOW_WEIGHTS: Record<
  Effects,
  {
    soft: number;
    medium: number;
    regular: number;
    strong: number;
    logo: number;
  }
> = {
  off: { soft: 0, medium: 0, regular: 0, strong: 0, logo: 0 },
  subtle: { soft: 8, medium: 18, regular: 28, strong: 34, logo: 28 },
  expressive: { soft: 14, medium: 28, regular: 42, strong: 54, logo: 48 },
};

function mixSurfaceColor(base: string, tint: string, weight: number): string {
  const baseColor = parseCssColor(base);
  const tintColor = parseCssColor(tint);
  if (!baseColor || !tintColor) return base;

  const mix = (baseChannel: number, tintChannel: number) =>
    Math.round(baseChannel * (1 - weight) + tintChannel * weight);
  const red = mix(baseColor.red, tintColor.red);
  const green = mix(baseColor.green, tintColor.green);
  const blue = mix(baseColor.blue, tintColor.blue);

  return baseColor.alpha === 1
    ? `rgb(${red}, ${green}, ${blue})`
    : `rgba(${red}, ${green}, ${blue}, ${baseColor.alpha})`;
}

function isSurfacePaintToken(name: string): boolean {
  return (
    name === "--crate-token-color-background" ||
    (name.startsWith("--crate-token-surface-") &&
      !name.includes("-foreground-") &&
      !name.includes("-border-"))
  );
}

function resolveSurfaceTone(
  appearance: AppearanceResolution,
  surfaces: Record<string, string>,
): Record<string, string> {
  const presetDefault = APPEARANCE_PRESET_REGISTRY[appearance.preset].defaults;
  if (appearance.effective.surfaceTone === presetDefault.surfaceTone) {
    return surfaces;
  }

  const tone = appearance.effective.surfaceTone;
  const tint =
    tone === "tinted"
      ? getAppearanceAccentColor(appearance)
      : tone === "warm"
        ? appearance.mode === "dark"
          ? "#f59e0b"
          : "#b45309"
        : appearance.mode === "dark"
          ? "#64748b"
          : "#94a3b8";
  const weight = tone === "tinted" ? 0.08 : tone === "warm" ? 0.06 : 0.05;

  return Object.fromEntries(
    Object.entries(surfaces).map(([name, value]) => [
      name,
      isSurfacePaintToken(name) ? mixSurfaceColor(value, tint, weight) : value,
    ]),
  );
}

export const APPEARANCE_PRESET_REGISTRY = {
  default: {
    id: "default",
    defaults: {
      accent: "cyan",
      surfaceTone: "neutral",
      material: "glass",
      radius: "subtle",
      typography: "brand",
      effects: "subtle",
    },
    modes: {
      dark: {
        accents: { cyan: "#06b6d4", red: "#ef4444", violet: "#8b5cf6" },
        danger: "#ef4444",
        surfaces: DEFAULT_DARK_SURFACES,
        extras: DEFAULT_DARK_EXTRAS,
      },
      light: {
        accents: { cyan: "#0e7490", red: "#dc2626", violet: "#7c3aed" },
        danger: "#dc2626",
        surfaces: DEFAULT_LIGHT_SURFACES,
        extras: DEFAULT_LIGHT_EXTRAS,
      },
    },
  },
  crateRed: {
    id: "crateRed",
    defaults: {
      accent: "red",
      surfaceTone: "warm",
      material: "glass",
      radius: "rounded",
      typography: "system",
      effects: "subtle",
    },
    modes: {
      dark: {
        accents: { cyan: "#06b6d4", red: "#ff375f", violet: "#8b5cf6" },
        danger: "#ff453a",
        surfaces: CRATE_RED_DARK_SURFACES,
        extras: {
          ...DEFAULT_DARK_EXTRAS,
          textSubtle: "#8e8e93",
          textFaint: "#636366",
          borderSubtle: "#3a3a3c",
          borderQuiet: "rgba(255, 255, 255, 0.12)",
          borderQuietSubtle: "rgba(255, 255, 255, 0.07)",
          glassShadow: "rgba(0, 0, 0, 0.42)",
        },
      },
      light: {
        accents: { cyan: "#0e7490", red: "#d61f45", violet: "#7c3aed" },
        danger: "#d70015",
        surfaces: CRATE_RED_LIGHT_SURFACES,
        extras: {
          ...DEFAULT_LIGHT_EXTRAS,
          textSubtle: "#636366",
          textFaint: "#aeaeb2",
          borderSubtle: "#d1d1d6",
          borderQuiet: "rgba(29, 29, 31, 0.12)",
          borderQuietSubtle: "rgba(29, 29, 31, 0.07)",
          glassShadow: "rgba(29, 29, 31, 0.16)",
        },
      },
    },
  },
} as const satisfies Record<PresetId, AppearancePresetDefinition>;

export function getAppearanceAccentColor(
  appearance: AppearanceResolution,
): string {
  return APPEARANCE_PRESET_REGISTRY[appearance.preset].modes[appearance.mode]
    .accents[appearance.effective.accent];
}

export function getAppearanceDangerColor(
  appearance: AppearanceResolution,
): string {
  return APPEARANCE_PRESET_REGISTRY[appearance.preset].modes[appearance.mode]
    .danger;
}

export function getAppearanceSurfaceColors(
  appearance: AppearanceResolution,
): Record<string, string> {
  const surfaces = APPEARANCE_PRESET_REGISTRY[appearance.preset].modes[
    appearance.mode
  ].surfaces as Record<string, string>;
  return resolveSurfaceTone(appearance, surfaces);
}

export function getAppearanceThemeColor(
  preset: PresetId,
  mode: ResolvedColorMode,
): string {
  const surfaces = APPEARANCE_PRESET_REGISTRY[preset].modes[mode]
    .surfaces as Record<string, string>;
  return surfaces["--crate-token-surface-app"]!;
}

export function resolveAppearanceVariables(
  appearance: AppearanceResolution,
): Record<string, string> {
  const mode =
    APPEARANCE_PRESET_REGISTRY[appearance.preset].modes[appearance.mode];
  const surfaces = getAppearanceSurfaceColors(appearance);
  const extras = mode.extras;
  const materialSuffix = appearance.effective.material;
  const surfaceValue = (name: string): string => surfaces[name]!;
  const accent = getAppearanceAccentColor(appearance);
  const danger = getAppearanceDangerColor(appearance);
  const accentForeground =
    chooseAccessibleForeground(accent) ?? DEFAULT_DARK_FOREGROUND;
  const dangerForeground =
    chooseAccessibleForeground(danger) ?? DEFAULT_DARK_FOREGROUND;
  const radiusValues = RADIUS_VALUES[appearance.effective.radius];
  const success = appearance.mode === "dark" ? "#22c55e" : "#15803d";
  const warning = appearance.mode === "dark" ? "#f59e0b" : "#b45309";
  const info = appearance.mode === "dark" ? "#3b82f6" : "#2563eb";
  const glowWeights = EFFECT_GLOW_WEIGHTS[appearance.effective.effects];
  const accentGlow = (weight: number) =>
    `color-mix(in srgb, ${accent} ${weight}%, transparent)`;

  return {
    ...surfaces,
    "--crate-token-color-primary": accent,
    "--crate-token-color-primary-foreground": accentForeground,
    "--crate-token-color-ring": accent,
    "--crate-token-color-destructive": danger,
    "--crate-token-color-destructive-foreground": dangerForeground,
    "--crate-token-color-success": success,
    "--crate-token-color-warning": warning,
    "--crate-token-color-info": info,
    ...radiusValues,
    "--color-background": surfaceValue("--crate-token-color-background"),
    "--color-card": surfaceValue(
      `--crate-token-surface-card-${materialSuffix}`,
    ),
    "--color-card-foreground": surfaceValue(
      `--crate-token-surface-card-foreground-${materialSuffix}`,
    ),
    "--color-secondary": surfaceValue(
      `--crate-token-surface-secondary-${materialSuffix}`,
    ),
    "--color-secondary-foreground": surfaceValue(
      `--crate-token-surface-secondary-foreground-${materialSuffix}`,
    ),
    "--color-muted": surfaceValue(
      `--crate-token-surface-muted-${materialSuffix}`,
    ),
    "--color-accent": surfaceValue(
      `--crate-token-surface-accent-${materialSuffix}`,
    ),
    "--color-accent-foreground": surfaceValue(
      `--crate-token-surface-accent-foreground-${materialSuffix}`,
    ),
    "--color-popover": surfaceValue(
      `--crate-token-surface-popover-${materialSuffix}`,
    ),
    "--color-popover-foreground": surfaceValue(
      `--crate-token-surface-popover-foreground-${materialSuffix}`,
    ),
    "--color-border": surfaceValue(
      `--crate-token-surface-border-${materialSuffix}`,
    ),
    "--color-input": surfaceValue(
      `--crate-token-surface-input-${materialSuffix}`,
    ),
    "--color-primary": accent,
    "--color-primary-foreground": accentForeground,
    "--color-foreground": surfaceValue("--crate-token-color-foreground"),
    "--color-muted-foreground": surfaceValue(
      "--crate-token-color-muted-foreground",
    ),
    "--color-destructive": danger,
    "--color-success": success,
    "--color-warning": warning,
    "--color-info": info,
    "--color-ring": accent,
    "--surface-app": surfaceValue("--crate-token-surface-app"),
    "--surface-panel": surfaceValue(
      `--crate-token-surface-panel-${materialSuffix}`,
    ),
    "--surface-raised": surfaceValue(
      `--crate-token-surface-raised-${materialSuffix}`,
    ),
    "--surface-modal": surfaceValue(
      `--crate-token-surface-modal-${materialSuffix}`,
    ),
    "--surface-popover": surfaceValue(
      `--crate-token-surface-overlay-${materialSuffix}`,
    ),
    "--scrollbar-thumb": surfaceValue("--crate-token-scrollbar-thumb"),
    "--scrollbar-hover": surfaceValue("--crate-token-scrollbar-hover"),
    "--text-primary": surfaceValue("--crate-token-color-foreground"),
    "--text-secondary": extras.textSecondary,
    "--text-muted": surfaceValue("--crate-token-color-muted-foreground"),
    "--text-subtle": extras.textSubtle,
    "--text-faint": extras.textFaint,
    "--border-subtle": extras.borderSubtle,
    "--border-quiet": extras.borderQuiet,
    "--border-quiet-subtle": extras.borderQuietSubtle,
    "--focus-ring": accent,
    "--accent-action": accent,
    "--accent-action-foreground": accentForeground,
    "--accent-action-glow-soft": accentGlow(glowWeights.soft),
    "--accent-action-glow-medium": accentGlow(glowWeights.medium),
    "--accent-action-glow": accentGlow(glowWeights.regular),
    "--accent-action-glow-strong": accentGlow(glowWeights.strong),
    "--state-danger": danger,
    "--state-danger-foreground": dangerForeground,
    "--state-success": success,
    "--state-warning": warning,
    "--state-info": info,
    "--idle-border": extras.idleBorder,
    "--idle-bg": extras.idleBackground,
    "--idle-text": extras.idleText,
    "--idle-text-muted": extras.idleTextMuted,
    "--idle-text-subtle": extras.idleTextSubtle,
    "--hover-border": extras.hoverBorder,
    "--hover-bg": extras.hoverBackground,
    "--hover-bg-strong": extras.hoverBackgroundStrong,
    "--surface-glass-shadow": extras.glassShadow,
    "--radius-sm": radiusValues["--crate-token-radius-sm"]!,
    "--radius-md": radiusValues["--crate-token-radius-md"]!,
    "--radius-lg": radiusValues["--crate-token-radius-lg"]!,
    "--radius-xl": radiusValues["--crate-token-radius-xl"]!,
    "--font-brand":
      appearance.effective.typography === "system"
        ? "system-ui, sans-serif"
        : "Poppins",
    "--brand-logo-start": accent,
    "--brand-logo-end": accent,
    "--brand-logo-glow": accentGlow(glowWeights.logo),
  };
}

function defaultAppearance(
  preset: PresetId,
  mode: ResolvedColorMode,
): AppearanceResolution {
  const effective = APPEARANCE_PRESET_REGISTRY[preset].defaults;
  return {
    mode,
    preset,
    preferences: {
      version: 2,
      mode,
      preset,
      overrides: {},
      presentation: { density: "comfortable" },
      accessibility: { motion: "system" },
    },
    effective,
    density: "comfortable",
    motion: "system",
    reducedMotion: false,
  };
}

const DEFAULT_VARIABLES = Object.fromEntries(
  (Object.keys(APPEARANCE_PRESET_REGISTRY) as PresetId[]).map((preset) => [
    preset,
    Object.fromEntries(
      (["dark", "light"] as ResolvedColorMode[]).map((mode) => [
        mode,
        resolveAppearanceVariables(defaultAppearance(preset, mode)),
      ]),
    ) as Record<ResolvedColorMode, Record<string, string>>,
  ]),
) as Record<PresetId, Record<ResolvedColorMode, Record<string, string>>>;

function tokenType(name: string): AppearanceTokenType {
  if (name.includes("radius")) return "length";
  if (name.includes("font")) return "font";
  if (name.includes("shadow") || name.includes("glow")) return "shadow";
  if (name.includes("gradient")) return "gradient";
  return "color";
}

function tokenDefaults(
  name: string,
): Record<PresetId, Record<ResolvedColorMode, string>> {
  return Object.fromEntries(
    (Object.keys(APPEARANCE_PRESET_REGISTRY) as PresetId[]).map((preset) => [
      preset,
      Object.fromEntries(
        (["dark", "light"] as ResolvedColorMode[]).map((mode) => [
          mode,
          DEFAULT_VARIABLES[preset][mode][name]!,
        ]),
      ),
    ]),
  ) as Record<PresetId, Record<ResolvedColorMode, string>>;
}

const TOKEN_NAMES = Object.keys(DEFAULT_VARIABLES.default.dark);

export const APPEARANCE_TOKEN_REGISTRY = Object.fromEntries(
  TOKEN_NAMES.map((name) => [
    name,
    {
      name,
      type: tokenType(name),
      defaults: tokenDefaults(name),
      overrideable:
        name.includes("primary") ||
        name.includes("surface") ||
        name.includes("radius") ||
        name.includes("font") ||
        name.includes("accent") ||
        name.includes("ring"),
      contrastPairs:
        name.includes("foreground") || name.includes("primary")
          ? ["surface", "control"]
          : [],
      owner: "design-system",
      consumers: ["shared-ui", "listen", "admin-preview"],
    } satisfies AppearanceTokenDefinition,
  ]),
) as Record<string, AppearanceTokenDefinition>;

export const APPEARANCE_VARIABLE_ALLOWLIST = Object.keys(
  APPEARANCE_TOKEN_REGISTRY,
);

export const APPEARANCE_FOUNDATION_VARIABLES =
  APPEARANCE_VARIABLE_ALLOWLIST.filter((name) =>
    name.startsWith("--crate-token-"),
  );

export function renderDefaultThemeCss(): string {
  const variables = APPEARANCE_FOUNDATION_VARIABLES.map((name) => {
    const value = APPEARANCE_TOKEN_REGISTRY[name]!.defaults.default.dark;
    return `  ${name}: ${value};`;
  }).join("\n");

  return `/* This file is generated from lib/appearance-token-registry.ts.
   Run \`npm run design-system:tokens:generate\` after changing foundations. */

:root {
${variables}
}

/* Runtime mode hooks. The active scope supplies explicit dark/light values. */
[data-crate-app="listen"][data-crate-mode="dark"],
[data-crate-app="listen"][data-crate-mode="light"] {
  --state-danger-foreground: var(--surface-canvas);
}
`;
}
