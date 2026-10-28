import { expect, test } from "@playwright/test";
import { openAppearanceHarness } from "./fixtures";

test.describe("fixed Crate v3 identity", () => {
  test("boots the fixed identity with real solid tokens", async ({ page }) => {
    await openAppearanceHarness(page);
    await expect(page.locator("html")).toHaveAttribute(
      "data-crate-identity",
      "v3",
    );
    await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
    await expect(page.getByTestId("appearance-card")).toHaveCSS(
      "background-color",
      "rgb(13, 14, 20)",
    );
    await expect(page.getByTestId("appearance-card")).toHaveCSS(
      "color",
      "rgb(241, 245, 249)",
    );
    await expect(page.getByTestId("identity-status")).toHaveText("Crate v3");
    await expect(page.getByTestId("mode-select")).toHaveCount(0);
    await expect(page.getByTestId("preset-select")).toHaveCount(0);
  });

  test("ignores OS color changes while responding live to reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({
      colorScheme: "dark",
      reducedMotion: "no-preference",
    });
    await openAppearanceHarness(page);
    const card = page.getByTestId("appearance-card");
    await expect(page.getByTestId("logo")).toHaveAttribute(
      "data-crate-logo-motion",
      "system",
    );
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
    await expect(card).toHaveCSS("background-color", "rgb(13, 14, 20)");
    await expect(page.getByTestId("logo")).toHaveAttribute(
      "data-crate-logo-motion",
      "reduced",
    );
    await page.emulateMedia({
      colorScheme: "dark",
      reducedMotion: "no-preference",
    });
    await expect(page.getByTestId("logo")).toHaveAttribute(
      "data-crate-logo-motion",
      "system",
    );
  });

  test("keeps primary, muted, accent and warning text AA on actual solid surfaces", async ({
    page,
  }) => {
    await openAppearanceHarness(page);
    const pairs = await page.evaluate(() => {
      const channel = (value: number) =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      const luminance = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const values = Array.from(context.getImageData(0, 0, 1, 1).data);
        if (values[3] !== 255)
          throw new Error(`Expected an opaque identity color: ${color}`);
        return values
          .slice(0, 3)
          .map((value) => channel(value / 255))
          .reduce(
            (sum, value, index) =>
              sum + value * [0.2126, 0.7152, 0.0722][index],
            0,
          );
      };
      const results = [];
      for (const surface of [
        "--surface-canvas",
        "--surface-object",
        "--surface-popover",
      ]) {
        for (const text of [
          "--text-primary",
          "--text-muted",
          "--accent-action-hi",
          "--state-warning-text",
        ]) {
          const probe = document.createElement("span");
          probe.style.backgroundColor = `var(${surface})`;
          probe.style.color = `var(${text})`;
          document.body.append(probe);
          const styles = getComputedStyle(probe);
          const fg = luminance(styles.color);
          const bg = luminance(styles.backgroundColor);
          results.push({
            surface,
            text,
            contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
          });
          probe.remove();
        }
      }
      const styles = getComputedStyle(
        document.querySelector("[data-testid=accent-button]")!,
      );
      const fg = luminance(styles.color);
      const bg = luminance(styles.backgroundColor);
      results.push({
        surface: "action",
        text: "action foreground",
        contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
      });
      return results;
    });
    expect(pairs).toHaveLength(13);
    for (const pair of pairs)
      expect(
        pair.contrast,
        `${pair.text} on ${pair.surface}`,
      ).toBeGreaterThanOrEqual(4.5);
  });
});
