import { CRATE_IDENTITY_VARIABLES } from "./appearance-token-registry";

const LEGACY_VISUAL_ATTRIBUTES = [
  "data-crate-mode",
  "data-crate-mode-preference",
  "data-crate-skin",
  "data-crate-surface-tone",
  "data-surface",
] as const;

const LEGACY_GLASS_VARIABLES = [
  "--crate-token-surface-card-glass",
  "--crate-token-surface-card-foreground-glass",
  "--crate-token-surface-secondary-glass",
  "--crate-token-surface-secondary-foreground-glass",
  "--crate-token-surface-muted-glass",
  "--crate-token-surface-accent-glass",
  "--crate-token-surface-accent-foreground-glass",
  "--crate-token-surface-popover-glass",
  "--crate-token-surface-popover-foreground-glass",
  "--crate-token-surface-border-glass",
  "--crate-token-surface-input-glass",
  "--crate-token-surface-panel-glass",
  "--crate-token-surface-raised-glass",
  "--crate-token-surface-modal-glass",
  "--crate-token-surface-overlay-glass",
] as const;

export function applyCrateIdentity(
  root: HTMLElement = document.documentElement,
): void {
  for (const name of LEGACY_VISUAL_ATTRIBUTES) root.removeAttribute(name);
  for (const name of [
    ...Object.keys(CRATE_IDENTITY_VARIABLES),
    ...LEGACY_GLASS_VARIABLES,
  ])
    root.style.removeProperty(name);
  root.dataset.crateIdentity = "v3";
  root.style.colorScheme = "dark";
}
