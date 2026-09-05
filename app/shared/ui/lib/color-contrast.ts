interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export function parseHexColor(value: string): RgbColor | null {
  const normalized = value.trim().replace(/^#/, "");
  if (![3, 6].includes(normalized.length) || !/^[\da-f]+$/i.test(normalized)) {
    return null;
  }

  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((channel) => `${channel}${channel}`)
          .join("")
      : normalized;
  const channels = expanded.match(/[\da-f]{2}/gi);
  if (!channels || channels.length !== 3) return null;

  return {
    red: Number.parseInt(channels[0]!, 16),
    green: Number.parseInt(channels[1]!, 16),
    blue: Number.parseInt(channels[2]!, 16),
  };
}

function relativeLuminance(color: RgbColor): number {
  const channels = [color.red, color.green, color.blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

export function contrastRatio(
  foreground: string,
  background: string,
): number | null {
  const foregroundColor = parseHexColor(foreground);
  const backgroundColor = parseHexColor(background);
  if (!foregroundColor || !backgroundColor) return null;

  const foregroundLuminance = relativeLuminance(foregroundColor);
  const backgroundLuminance = relativeLuminance(backgroundColor);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsWcagAa(
  foreground: string,
  background: string,
  largeText = false,
): boolean {
  const ratio = contrastRatio(foreground, background);
  return ratio !== null && ratio >= (largeText ? 3 : 4.5);
}
