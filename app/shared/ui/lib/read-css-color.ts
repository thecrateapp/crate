export function readCssColorToken(
  element: HTMLElement,
  tokenName: `--${string}`,
): string | null {
  const previousColor = element.style.getPropertyValue("color");
  const previousPriority = element.style.getPropertyPriority("color");

  element.style.setProperty("color", `var(${tokenName})`);
  const resolvedColor = getComputedStyle(element).color.trim();

  if (previousColor) {
    element.style.setProperty("color", previousColor, previousPriority);
  } else {
    element.style.removeProperty("color");
  }

  return resolvedColor || null;
}

export interface CssRgb {
  r: number;
  g: number;
  b: number;
}

const unit = (value: number) => Math.max(0, Math.min(1, value));

export function parseCssColor(value: string): CssRgb | null {
  const text = value.trim().toLowerCase();
  const srgb = text.match(
    /^color\(\s*srgb\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*(?:\/[^)]*)?\)$/,
  );
  if (srgb)
    return { r: unit(+srgb[1]!), g: unit(+srgb[2]!), b: unit(+srgb[3]!) };
  const rgb = text.match(
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/][^)]*)?\)$/,
  );
  if (rgb)
    return {
      r: unit(+rgb[1]! / 255),
      g: unit(+rgb[2]! / 255),
      b: unit(+rgb[3]! / 255),
    };
  const hex = text.match(/^#([\da-f]{3}|[\da-f]{6})$/);
  if (hex) {
    const digits =
      hex[1]!.length === 3
        ? [...hex[1]!].map((digit) => digit + digit).join("")
        : hex[1]!;
    return {
      r: parseInt(digits.slice(0, 2), 16) / 255,
      g: parseInt(digits.slice(2, 4), 16) / 255,
      b: parseInt(digits.slice(4, 6), 16) / 255,
    };
  }
  return null;
}

export function readCssColorRgb(
  element: HTMLElement,
  tokenName: `--${string}`,
): CssRgb | null {
  const value = readCssColorToken(element, tokenName);
  return value ? parseCssColor(value) : null;
}
