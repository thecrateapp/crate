import theme from "./code-theme.json";

/**
 * Source-viewer token colours as shared classes. Snapshots name a class per
 * highlighted run instead of repeating an inline style on every token; the
 * viewer component ships these rules once.
 */
const DEFAULT_FOREGROUND = theme.colors["editor.foreground"].toLowerCase();
const FOREGROUNDS = [...new Set(theme.tokenColors.flatMap((rule) => {
  const color = (rule.settings as { foreground?: string }).foreground?.toLowerCase();
  return color && color !== DEFAULT_FOREGROUND ? [color] : [];
}))];

/** Class list for a Shiki token. The theme's default foreground needs none. */
export function tokenClass(color: string | undefined, fontStyle = 0): string {
  const classes: string[] = [];
  const hex = color?.toLowerCase();
  if (hex && hex !== DEFAULT_FOREGROUND) {
    // Shiki only emits theme colours. Anything else means the stylesheet and the
    // snapshots disagree, which would silently drop colour in production.
    if (!FOREGROUNDS.includes(hex)) throw new Error(`Token colour ${color} is not defined by the code theme.`);
    classes.push(`gfp-c-${hex.slice(1)}`);
  }
  if (fontStyle & 1) classes.push("gfp-i");
  if (fontStyle & 2) classes.push("gfp-b");
  return classes.join(" ");
}

export const previewTokenCss = [
  ...FOREGROUNDS.map((color) => `.gfp-code .gfp-c-${color.slice(1)}{color:${color}}`),
  ".gfp-code .gfp-i{font-style:italic}",
  ".gfp-code .gfp-b{font-weight:600}",
].join("\n");
