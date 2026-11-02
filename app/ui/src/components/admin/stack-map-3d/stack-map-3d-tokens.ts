export interface StackMap3DTokens {
  bloom: { strength: number; radius: number; threshold: number } | null;
  rim: { application: number; quiet: number };
  lines: { rest: number; live: number; active: number; quiet: number };
  durations: { intro: number; fly: number; reset: number };
}

const INTRO_STEPS = 5.2;
const FLY_STEPS = 3.6;
const DEFAULT_DURATION_MS = 250;

function readNumber(
  style: CSSStyleDeclaration,
  name: string,
  fallback: number,
) {
  const value = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

export function parseDuration(value: string): number | null {
  const match = value.trim().match(/^(-?[\d.]+)(ms|s)$/);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]!);
  return match[2] === "s" ? amount * 1000 : amount;
}

export function readStackMap3DTokens(
  element: HTMLElement,
  root: HTMLElement = document.documentElement,
): StackMap3DTokens {
  const style = getComputedStyle(element);
  const step =
    parseDuration(style.getPropertyValue("--motion-duration-normal")) ??
    DEFAULT_DURATION_MS;
  const effects = root.dataset.crateEffects;
  const bloomScale = effects === "expressive" ? 1.3 : 1;
  return {
    bloom:
      effects === "off"
        ? null
        : {
            strength:
              readNumber(style, "--stack-map-3d-bloom-strength", 0.5) *
              bloomScale,
            radius: readNumber(style, "--stack-map-3d-bloom-radius", 0.4),
            threshold: readNumber(
              style,
              "--stack-map-3d-bloom-threshold",
              0.78,
            ),
          },
    rim: {
      application: readNumber(style, "--stack-map-3d-rim-strength", 0.4),
      quiet: readNumber(style, "--stack-map-3d-rim-strength-quiet", 0.26),
    },
    lines: {
      rest: readNumber(style, "--stack-map-3d-line-rest", 1.6),
      live: readNumber(style, "--stack-map-3d-line-live", 2),
      active: readNumber(style, "--stack-map-3d-line-active", 2.8),
      quiet: readNumber(style, "--stack-map-3d-line-quiet", 1.2),
    },
    durations: {
      intro: Math.round(step * INTRO_STEPS),
      fly: Math.round(step * FLY_STEPS),
      reset: Math.round(step * FLY_STEPS),
    },
  };
}
