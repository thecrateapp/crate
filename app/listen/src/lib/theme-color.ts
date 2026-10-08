import type { ResolvedColorMode } from "@crate/ui/lib/theme-skin";
import { getAppearanceThemeColor } from "@crate/ui/lib/appearance-token-registry";

export function readThemeColor(
  root: HTMLElement,
  mode: ResolvedColorMode,
): string {
  const computed = getComputedStyle(root);
  return (
    computed.getPropertyValue("--crate-token-surface-app").trim() ||
    computed.getPropertyValue("--surface-app").trim() ||
    getAppearanceThemeColor("default", mode)
  );
}

export function syncThemeColor(
  root: HTMLElement,
  mode: ResolvedColorMode,
): string {
  const color = readThemeColor(root, mode);
  const meta = root.ownerDocument.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );

  if (meta) meta.content = color;
  return color;
}
