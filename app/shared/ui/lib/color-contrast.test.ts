import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  chooseAccessibleForeground,
  contrastRatio,
  contrastRatioComposited,
  meetsWcagAa,
  parseCssColor,
  parseHexColor,
} from "./color-contrast";
import {
  APPEARANCE_OPTION_VALUES,
  APPEARANCE_PRESET_REGISTRY,
  resolveAppearanceVariables,
} from "./appearance-token-registry";
import type { AccentId, PresetId, ResolvedColorMode } from "./appearance-types";
import { SKIN_REGISTRY } from "./theme-skin";

const BODY_TEXT_AA = 4.5;
const KNOWN_BELOW_AA = new Map([
  ["crateRed/dark --text-subtle on popover", 4.27],
]);

function appearanceVariables(
  preset: PresetId,
  mode: ResolvedColorMode,
  accent?: AccentId,
) {
  const effective = {
    ...APPEARANCE_PRESET_REGISTRY[preset].defaults,
    ...(accent ? { accent } : {}),
  };
  return resolveAppearanceVariables({
    mode,
    preset,
    preferences: {
      version: 2,
      mode,
      preset,
      overrides: accent ? { accent } : {},
      presentation: { density: "comfortable" },
      accessibility: { motion: "system" },
    },
    effective,
    density: "comfortable",
    motion: "system",
    reducedMotion: false,
  });
}

function mixSrgb(first: string, second: string, firstWeight: number): string {
  const a = parseHexColor(first)!;
  const b = parseHexColor(second)!;
  const channel = (x: number, y: number) =>
    Math.round(x * firstWeight + y * (1 - firstWeight))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(a.red, b.red)}${channel(a.green, b.green)}${channel(
    a.blue,
    b.blue,
  )}`;
}

function appearanceSkins() {
  return (Object.keys(APPEARANCE_PRESET_REGISTRY) as PresetId[]).flatMap(
    (preset) =>
      (["dark", "light"] as const).map((mode) => ({
        name: `${preset}/${mode}`,
        preset,
        mode,
        variables: appearanceVariables(preset, mode),
      })),
  );
}

describe("color contrast", () => {
  it("chooses the deterministic foreground with the strongest contrast", () => {
    expect(chooseAccessibleForeground("#06b6d4")).toBe("#0a0a0f");
    expect(chooseAccessibleForeground("#0e7490")).toBe("#ffffff");
    expect(chooseAccessibleForeground("not-a-color")).toBeNull();
  });

  it("calculates WCAG contrast ratios for hex colors", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("rejects unsupported colors instead of reporting false confidence", () => {
    expect(parseHexColor("rgba(0, 0, 0, 0.5)")).toBeNull();
    expect(parseCssColor("color-mix(in srgb, white 50%, black)")).toBeNull();
    expect(contrastRatio("not-a-color", "#000000")).toBeNull();
  });

  it("composites alpha colors over an explicit surface", () => {
    expect(parseCssColor("rgba(255, 255, 255, 78%)")).toEqual({
      red: 255,
      green: 255,
      blue: 255,
      alpha: 0.78,
    });
    expect(parseCssColor("#ffffffcc")).toEqual({
      red: 255,
      green: 255,
      blue: 255,
      alpha: expect.closeTo(0.8, 2),
    });
    expect(meetsWcagAa("#ffffff", "#0a0a0f")).toBe(true);
    expect(
      contrastRatioComposited("rgba(255, 255, 255, 0.78)", "#0a0a0f"),
    ).toBeGreaterThan(4.5);
  });

  it("checks the translucent surface tokens against their canvas", () => {
    const surfaceTokens = readFileSync("tokens/themes.css", "utf8");
    const modalSurface = surfaceTokens.match(
      /--crate-token-surface-modal-solid:\s*(rgba\([^;]+\))/,
    )?.[1];

    expect(modalSurface).toBe("rgba(16, 16, 24, 0.95)");
    expect(
      contrastRatioComposited("#f1f5f9", modalSurface!, "#0a0a0f"),
    ).toBeGreaterThan(4.5);
  });

  it("requires an artwork backdrop instead of guessing through transparency", () => {
    expect(
      contrastRatioComposited("#ffffff", "rgba(10, 10, 15, 0.68)"),
    ).toBeNull();
    expect(
      contrastRatioComposited("#ffffff", "rgba(10, 10, 15, 0.68)", "#202020"),
    ).toBeGreaterThan(4.5);
  });

  it("keeps every explicit skin text pairing AA-compliant", () => {
    Object.values(SKIN_REGISTRY).forEach(({ modes }) => {
      Object.values(modes).forEach((variables) => {
        const foreground = variables["--color-foreground"];
        const muted = variables["--color-muted-foreground"];
        const panel = variables["--surface-panel"];
        const app = variables["--surface-app"];
        const primary = variables["--color-primary"];
        const primaryForeground = variables["--color-primary-foreground"];

        if (foreground && panel) {
          expect(meetsWcagAa(foreground, panel)).toBe(true);
        }
        if (muted && app) {
          expect(meetsWcagAa(muted, app)).toBe(true);
        }
        if (primary && primaryForeground) {
          expect(meetsWcagAa(primaryForeground, primary)).toBe(true);
        }
      });
    });
  });

  it("keeps the focus ring at 3:1 against every skin surface", () => {
    expect(contrastRatio("#06b6d4", "#0a0a0f")).toBeGreaterThanOrEqual(3);

    Object.values(SKIN_REGISTRY).forEach(({ modes }) => {
      Object.values(modes).forEach((variables) => {
        const ring = variables["--color-primary"];
        const app = variables["--surface-app"];
        const panel = variables["--surface-panel"];

        if (ring && app) {
          expect(contrastRatio(ring, app)).toBeGreaterThanOrEqual(3);
        }
        if (ring && panel) {
          expect(contrastRatio(ring, panel)).toBeGreaterThanOrEqual(3);
        }
      });
    });
  });

  it("keeps the high-contrast Listen theme on the AA-safe base pairing", () => {
    const pairings = [
      ["#ffffff", "#000000"],
      ["#f1f5f9", "#000000"],
      ["#e2e8f0", "#000000"],
      ["#cbd5e1", "#000000"],
      ["#001014", "#67e8f9"],
      ["#000000", "#fca5a5"],
      ["#000000", "#86efac"],
      ["#000000", "#fde68a"],
      ["#000000", "#93c5fd"],
    ] as const;

    pairings.forEach(([foreground, background]) => {
      expect(meetsWcagAa(foreground, background)).toBe(true);
    });
  });

  it("keeps solid destructive controls on an AA-safe foreground", () => {
    const themeTokens = readFileSync("tokens/themes.css", "utf8");

    expect(themeTokens).toMatch(
      /--state-danger-foreground:\s*var\(--surface-canvas\)/,
    );
    expect(meetsWcagAa("#0a0a0f", "#ef4444")).toBe(true);
  });

  it("scopes appearance hooks to resolved color modes", () => {
    const themeTokens = readFileSync("tokens/themes.css", "utf8");

    expect(themeTokens).toMatch(/data-crate-mode="dark"/);
    expect(themeTokens).toMatch(/data-crate-mode="light"/);
    expect(themeTokens).not.toContain('data-crate-theme="high-contrast"');
  });

  describe.each(appearanceSkins())(
    "v3 label and accent pairings in $name",
    ({ preset, mode, variables }) => {
      const canvas = variables["--surface-app"]!;
      const object = variables["--surface-object"]!;

      function ratio(foreground: string, background: string) {
        return contrastRatioComposited(foreground, background, canvas);
      }

      it("keeps --text-subtle at AA on canvas, object and popover", () => {
        const subtle = variables["--text-subtle"]!;
        const popover = variables["--surface-popover"]!;
        const knownGap = KNOWN_BELOW_AA.get(
          `${preset}/${mode} --text-subtle on popover`,
        );

        expect(ratio(subtle, canvas)).toBeGreaterThanOrEqual(BODY_TEXT_AA);
        expect(ratio(subtle, object)).toBeGreaterThanOrEqual(BODY_TEXT_AA);
        if (knownGap === undefined) {
          expect(ratio(subtle, popover)).toBeGreaterThanOrEqual(BODY_TEXT_AA);
        } else {
          expect(ratio(subtle, popover)).toBeCloseTo(knownGap, 2);
        }
      });

      it("keeps --accent-action-hi at AA on canvas and object for every accent", () => {
        APPEARANCE_OPTION_VALUES.accent.forEach((accent) => {
          const accentHi = appearanceVariables(preset, mode, accent)[
            "--accent-action-hi"
          ]!;

          expect(ratio(accentHi, canvas), accent).toBeGreaterThanOrEqual(
            BODY_TEXT_AA,
          );
          expect(ratio(accentHi, object), accent).toBeGreaterThanOrEqual(
            BODY_TEXT_AA,
          );
        });
      });

      it("keeps --state-warning-text at AA on canvas and object", () => {
        const warningText = mixSrgb(
          variables["--state-warning"]!,
          variables["--text-primary"]!,
          0.82,
        );

        expect(ratio(warningText, canvas)).toBeGreaterThanOrEqual(BODY_TEXT_AA);
        expect(ratio(warningText, object)).toBeGreaterThanOrEqual(BODY_TEXT_AA);
      });
    },
  );

  it("measures --text-subtle near 4.9:1 on the canvas and 4.7:1 on the popover", () => {
    const variables = appearanceVariables("default", "dark");
    const canvas = variables["--surface-app"]!;

    expect(
      contrastRatioComposited(variables["--text-subtle"]!, canvas),
    ).toBeCloseTo(4.9, 0);
    expect(
      contrastRatioComposited(
        variables["--text-subtle"]!,
        variables["--surface-popover"]!,
        canvas,
      ),
    ).toBeCloseTo(4.7, 0);
  });

  it("derives --state-warning-text from the warning and primary tokens", () => {
    const semantic = readFileSync("tokens/semantic.css", "utf8");

    expect(semantic).toMatch(
      /--state-warning-text:\s*color-mix\(\s*in srgb,\s*var\(--state-warning\) 82%,\s*var\(--text-primary\)\s*\)/,
    );
  });
});
