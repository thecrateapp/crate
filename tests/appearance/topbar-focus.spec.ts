import { expect, test, type Locator } from "@playwright/test";
import { APPEARANCE_VIEWPORTS } from "./fixtures";

async function expectUnclippedInsetOutline(target: Locator) {
  await expect(target).toHaveCSS("outline-style", "solid");
  await expect(target).toHaveCSS("outline-width", "2px");
  await expect(target).toHaveCSS("outline-offset", "-2px");
  await expect(target).toHaveCSS("outline-color", "rgb(6, 182, 212)");

  const geometry = await target.evaluate((element) => {
    const css = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    const outset = parseFloat(css.outlineOffset) + parseFloat(css.outlineWidth);
    const outline = {
      left: bounds.left - outset,
      right: bounds.right + outset,
      top: bounds.top - outset,
      bottom: bounds.bottom + outset,
    };
    const clippingAncestors = [];
    for (
      let ancestor = element.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const style = getComputedStyle(ancestor);
      const rect = ancestor.getBoundingClientRect();
      const scaleX = rect.width / ancestor.offsetWidth;
      const scaleY = rect.height / ancestor.offsetHeight;
      const clipsX = ["hidden", "clip", "auto", "scroll"].includes(
        style.overflowX,
      );
      const clipsY = ["hidden", "clip", "auto", "scroll"].includes(
        style.overflowY,
      );
      if (clipsX || clipsY) {
        clippingAncestors.push({
          clipsX,
          clipsY,
          left: rect.left + ancestor.clientLeft * scaleX,
          top: rect.top + ancestor.clientTop * scaleY,
          right:
            rect.left + (ancestor.clientLeft + ancestor.clientWidth) * scaleX,
          bottom:
            rect.top + (ancestor.clientTop + ancestor.clientHeight) * scaleY,
        });
      }
    }
    return { outline, clippingAncestors };
  });

  expect(geometry.clippingAncestors.length).toBeGreaterThan(0);
  for (const clip of geometry.clippingAncestors) {
    if (clip.clipsX) {
      expect(geometry.outline.left).toBeGreaterThanOrEqual(clip.left - 1);
      expect(geometry.outline.right).toBeLessThanOrEqual(clip.right + 1);
    }
    if (clip.clipsY) {
      expect(geometry.outline.top).toBeGreaterThanOrEqual(clip.top - 1);
      expect(geometry.outline.bottom).toBeLessThanOrEqual(clip.bottom + 1);
    }
  }
}

for (const viewport of ["desktop", "mobile"] as const) {
  test.describe(`real TopBarSearch ${viewport}`, () => {
    test.use({ viewport: APPEARANCE_VIEWPORTS[viewport] });

    for (const open of [false, true]) {
      test(`keeps keyboard outlines visible in the ${
        open ? "open" : "closed"
      } view`, async ({ page, browserName }) => {
        // Safari on macOS uses Option+Tab to include buttons in keyboard navigation.
        const nextControl =
          browserName === "webkit" && process.platform === "darwin"
            ? "Alt+Tab"
            : "Tab";
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto(`/topbar-search.html?open=${open}`);
        const trigger = page.getByRole("button", {
          name: "Search",
          exact: true,
          includeHidden: true,
        });
        const input = page.getByPlaceholder(
          "Search artists, albums, tracks...",
        );
        await expect(trigger).toHaveAttribute("aria-expanded", String(open));
        if (open) {
          await expect(trigger).toBeHidden();
          await expect(input).toBeVisible();
        } else {
          await expect(trigger).toBeVisible();
          await expect(input).toBeHidden();
        }

        await page.getByTestId("before-search").focus();
        await page.keyboard.press(nextControl);
        const activeControl = open ? input : trigger;
        await expect(activeControl).toBeFocused();
        await expectUnclippedInsetOutline(activeControl);
        await page.keyboard.press(nextControl);
        await expect(page.getByTestId("after-search")).toBeFocused();
      });
    }
  });
}
