import { create } from "storybook/theming";
import { CRATE_IDENTITY_VARIABLES as identity } from "../../../app/shared/ui/lib/appearance-token-registry";

/** Map the existing Crate identity to Storybook's supported chrome theme API. */
export const crateTheme = create({
  base: "dark",
  brandTitle: "Crate UI · Design System",
  brandUrl: "./?path=/docs/system-introduction--docs",
  brandTarget: "_self",
  colorPrimary: identity["--accent-action"],
  colorSecondary: identity["--accent-action"],
  appBg: identity["--surface-app"],
  appContentBg: identity["--surface-app"],
  appPreviewBg: identity["--surface-app"],
  appBorderColor: identity["--border-quiet"],
  appBorderRadius: parseFloat(identity["--radius-md"]) * 16,
  fontBase: `${identity["--font-brand"]}, sans-serif`,
  fontCode: identity["--font-mono-stack"],
  textColor: identity["--text-primary"],
  textInverseColor: identity["--surface-app"],
  barTextColor: identity["--text-muted"],
  barHoverColor: identity["--accent-action-hi"],
  barSelectedColor: identity["--accent-action-hi"],
  barBg: identity["--surface-panel"],
  buttonBg: identity["--color-secondary"],
  buttonBorder: identity["--border-quiet"],
  inputBg: identity["--color-input"],
  inputBorder: identity["--border-quiet"],
  inputTextColor: identity["--text-primary"],
  inputBorderRadius: parseFloat(identity["--radius-md"]) * 16,
});
