import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const HERO_HEIGHTS = [
  "hero-sm",
  "hero-md",
  "hero-lg",
  "hero-xl",
  "hero-2xl",
  "hero-3xl",
];

const crateTwMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["panel"],
      tracking: [
        "display-tighter",
        "display-tight",
        "display",
        "label",
        "caps",
        "kicker",
        "eyebrow",
        "eyebrow-wide",
        "overline",
        "overline-wide",
      ],
      container: ["content"],
    },
    classGroups: {
      "font-size": [
        { text: ["badge", "counter", "micro", "2xs", "caption", "body"] },
      ],
      h: [{ h: HERO_HEIGHTS }],
      "min-h": [{ "min-h": HERO_HEIGHTS }],
      "max-h": [{ "max-h": HERO_HEIGHTS }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return crateTwMerge(clsx(inputs));
}
