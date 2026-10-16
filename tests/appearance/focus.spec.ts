import { expect, test, type Locator } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openAppearanceHarness } from "./fixtures";

const semanticCss = readFileSync(
  resolve(process.cwd(), "app/shared/ui/tokens/semantic.css"),
  "utf8",
);
const legacyFocusShadow = semanticCss.match(/--shadow-focus:\s*([^;]+);/)?.[1];
if (!legacyFocusShadow) throw new Error("Home search focus recipe is missing");

async function keyboardFocus(target: Locator) {
  await target.focus();
  await expect(target).toBeFocused();
}

async function expectOutline(target: Locator, offset: string) {
  await target.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations()
        .filter((animation) => animation.id === "crate-focus-ring")
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  await expect(target).toHaveCSS("outline-style", "solid");
  await expect(target).toHaveCSS("outline-width", "2px");
  await expect(target).toHaveCSS("outline-offset", offset);
  await expect(target).toHaveCSS("outline-color", "rgb(6, 182, 212)");
}

test.describe("global keyboard focus", () => {
  test.beforeEach(async ({ page }) => {
    await openAppearanceHarness(page);
    await page.keyboard.press("Tab");
  });

  test("outlines real controls and survives layered outline suppression and existing recipes", async ({
    page,
  }) => {
    for (const name of [
      "default",
      "icon",
      "switch",
      "checkbox",
      "radio",
      "input",
      "utility",
      "jam",
      "jam-input",
      "radio-input",
      "signal",
    ]) {
      const target = page.getByTestId(`focus-${name}`);
      await keyboardFocus(target);
      await expectOutline(target, "0px");
    }
  });

  test("uses the same flush outline on real CTAs without changing their layout", async ({
    page,
  }) => {
    for (const name of ["cta", "play"]) {
      const target = page.getByTestId(`focus-${name}`);
      const before = await target.boundingBox();
      await keyboardFocus(target);
      await expectOutline(target, "0px");
      const after = await target.boundingBox();
      expect(after?.width).toBe(before?.width);
      expect(after?.height).toBe(before?.height);
    }
  });

  test("matches the Home search ring geometry and color while preserving existing shadows", async ({
    page,
  }) => {
    for (const name of ["default", "cta", "play"]) {
      const target = page.getByTestId(`focus-${name}`);
      const shadowBefore = await target.evaluate(
        (element) => getComputedStyle(element).boxShadow,
      );
      await keyboardFocus(target);
      await expectOutline(target, "0px");
      const styles = await target.evaluate((element, legacyRecipe) => {
        const originalRect = element.getBoundingClientRect();
        const reference = element.cloneNode(false) as HTMLElement;
        reference.removeAttribute("data-testid");
        reference.tabIndex = -1;
        reference.setAttribute("aria-hidden", "true");
        reference.style.position = "absolute";
        reference.style.visibility = "hidden";
        reference.style.width = `${originalRect.width}px`;
        reference.style.height = `${originalRect.height}px`;
        reference.style.boxShadow = legacyRecipe;
        element.parentElement!.append(reference);
        const legacy = getComputedStyle(reference);
        const current = getComputedStyle(element);
        const shadow = legacy.boxShadow.match(
          /^(rgba?\([^)]+\))\s+0px\s+0px\s+0px\s+(\d+)px$/,
        );
        if (!shadow)
          throw new Error(`Unexpected Home search ring: ${legacy.boxShadow}`);
        const outlineOutset =
          parseFloat(current.outlineWidth) + parseFloat(current.outlineOffset);
        const referenceRect = reference.getBoundingClientRect();
        const result = {
          color: current.outlineColor,
          legacyColor: shadow[1],
          outlineOutset,
          legacyOutset: Number(shadow[2]),
          radius: current.borderRadius,
          legacyRadius: legacy.borderRadius,
          width: originalRect.width + outlineOutset * 2,
          legacyWidth: referenceRect.width + Number(shadow[2]) * 2,
          height: originalRect.height + outlineOutset * 2,
          legacyHeight: referenceRect.height + Number(shadow[2]) * 2,
          shadow: current.boxShadow,
        };
        reference.remove();
        return result;
      }, legacyFocusShadow);
      expect(styles.color).toBe(styles.legacyColor);
      expect(styles.outlineOutset).toBe(styles.legacyOutset);
      expect(styles.outlineOutset).toBe(2);
      expect(styles.radius).toBe(styles.legacyRadius);
      expect(styles.width).toBeCloseTo(styles.legacyWidth, 1);
      expect(styles.height).toBeCloseTo(styles.legacyHeight, 1);
      expect(styles.shadow).toBe(shadowBefore);
    }
  });

  test("keeps row, menu, clipped-link and nested genre outlines inside their bounds", async ({
    page,
  }) => {
    for (const target of [
      page.getByTestId("focus-row"),
      page.getByTestId("focus-menu"),
      page.getByTestId("focus-link"),
      page.getByRole("button", { name: "Remove focus genre" }),
    ]) {
      await keyboardFocus(target);
      await expectOutline(target, "-2px");
    }
  });

  test("reserves focus-visible for keyboard navigation on buttons", async ({
    page,
  }) => {
    const target = page.getByTestId("focus-default");
    await target.click();
    await expect(target).not.toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Tab");
    await target.focus();
    await expectOutline(target, "0px");
  });

  test("keeps the real Radix select options outlined inside their scrollable portal", async ({
    page,
  }) => {
    const trigger = page.getByTestId("focus-select-trigger");
    await keyboardFocus(trigger);
    await trigger.press("ArrowDown");
    const albums = page.getByRole("option", { name: "Albums", exact: true });
    await expect(albums).toBeFocused();
    await expectOutline(albums, "-2px");
    await page.keyboard.press("ArrowDown");
    const artists = page.getByRole("option", { name: "Artists", exact: true });
    await expect(artists).toBeFocused();
    await expectOutline(artists, "-2px");
  });

  test("uses accent selection with canvas text, including inputs", async ({
    page,
  }) => {
    for (const target of [
      page.getByTestId("selection-text"),
      page.getByTestId("focus-input"),
    ]) {
      const selected = await target.evaluate((element) => {
        const css = getComputedStyle(element, "::selection");
        return { background: css.backgroundColor, color: css.color };
      });
      expect(selected).toEqual({
        background: "rgb(6, 182, 212)",
        color: "rgb(10, 10, 15)",
      });
    }
  });

  test("preserves a system-colored outline in forced colors", async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" });
    const target = page.getByTestId("focus-default");
    await keyboardFocus(target);
    const highlight = await page.evaluate(() => {
      const marker = document.createElement("span");
      marker.style.color = "Highlight";
      document.body.append(marker);
      const color = getComputedStyle(marker).color;
      marker.remove();
      return color;
    });
    await expect(target).toHaveCSS("outline-color", highlight);
    await expect(target).toHaveCSS("outline-style", "solid");
    await expect(target).toHaveCSS("outline-width", "2px");
    if (
      await page.evaluate(() => CSS.supports("forced-color-adjust", "auto"))
    ) {
      await expect(target).toHaveCSS("forced-color-adjust", "auto");
    }
  });
});
