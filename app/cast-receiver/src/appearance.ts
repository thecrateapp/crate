import type { CSSProperties } from "react";

import type { CastAppearance, CastResolvedMode } from "@crate/cast-protocol";

const THEMES = {
  default: {
    dark: {
      accent: "#16b8d4",
      background: "#07090f",
      foreground: "#f4f6fb",
      muted: "#8592a9",
      panel: "#10141d",
    },
    light: {
      accent: "#087f95",
      background: "#eef3f6",
      foreground: "#111827",
      muted: "#536174",
      panel: "#ffffff",
    },
  },
  "crate-red": {
    dark: {
      accent: "#ff4059",
      background: "#0d080a",
      foreground: "#fff4f5",
      muted: "#aa8e94",
      panel: "#1a1013",
    },
    light: {
      accent: "#d71936",
      background: "#fff3f4",
      foreground: "#241216",
      muted: "#76545c",
      panel: "#ffffff",
    },
  },
} as const;

type ReceiverSkinId = keyof typeof THEMES;

export interface ResolvedReceiverAppearance {
  accent: string;
  cssVariables: CSSProperties;
  mode: CastResolvedMode;
  reducedMotion: boolean;
  skinId: ReceiverSkinId;
}

export const DEFAULT_RECEIVER_APPEARANCE: CastAppearance = {
  contractVersion: 1,
  skinId: "default",
  preferredMode: "system",
  resolvedMode: "dark",
  reducedMotion: false,
};

function knownSkinId(value: string): ReceiverSkinId {
  return value === "crate-red" ? "crate-red" : "default";
}

export function resolveReceiverAppearance(
  appearance: CastAppearance,
): ResolvedReceiverAppearance {
  const skinId = knownSkinId(appearance.skinId);
  const mode = appearance.resolvedMode === "light" ? "light" : "dark";
  const theme = THEMES[skinId][mode];
  return {
    accent: theme.accent,
    cssVariables: {
      "--receiver-accent": theme.accent,
      "--receiver-background": theme.background,
      "--receiver-foreground": theme.foreground,
      "--receiver-muted": theme.muted,
      "--receiver-panel": theme.panel,
    } as CSSProperties,
    mode,
    reducedMotion: appearance.reducedMotion,
    skinId,
  };
}
