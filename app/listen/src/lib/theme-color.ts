import { CRATE_IDENTITY_VARIABLES } from "@crate/ui/lib/appearance-token-registry";

export function readThemeColor(root: HTMLElement): string {
  const computed = getComputedStyle(root);
  return (
    computed.getPropertyValue("--crate-token-surface-app").trim() ||
    computed.getPropertyValue("--surface-app").trim() ||
    CRATE_IDENTITY_VARIABLES["--crate-token-surface-app"]
  );
}

export function syncThemeColor(root: HTMLElement): string {
  const color = readThemeColor(root);
  const meta = root.ownerDocument.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );

  if (meta) meta.content = color;
  return color;
}
