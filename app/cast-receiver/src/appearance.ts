import type { CSSProperties } from "react";
import type { CastAppearance } from "@crate/cast-protocol";

export interface ResolvedReceiverAppearance {
  accent: string;
  cssVariables: CSSProperties;
  mode: "dark";
  reducedMotion: boolean;
  skinId: "default";
}

export const DEFAULT_RECEIVER_APPEARANCE: CastAppearance = {
  contractVersion: 1,
  skinId: "default",
  preferredMode: "dark",
  resolvedMode: "dark",
  reducedMotion: false,
};

export function resolveReceiverAppearance(
  appearance: CastAppearance,
): ResolvedReceiverAppearance {
  return {
    accent: "#67e8f9",
    cssVariables: {
      "--receiver-accent": "#67e8f9",
      "--receiver-background": "#0a0a0f",
      "--receiver-foreground": "#f1f5f9",
      "--receiver-muted": "#999ca0",
      "--receiver-panel": "#0d0e14",
    } as CSSProperties,
    mode: "dark",
    reducedMotion: appearance.reducedMotion,
    skinId: "default",
  };
}
