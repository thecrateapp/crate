import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 393, height: 873 },
  { width: 320, height: 568 },
  { width: 740, height: 360 },
]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({
      viewport,
      hasTouch: true,
      reducedMotion: "reduce",
    });

    test("actual technique and one-pixel disc ring remain coherent and clear on pause/end", async ({
      page,
    }) => {
      await page.goto(
        "/iframe.html?id=listen-player--actual-transition&viewMode=story",
      );
      const indicator = page.getByRole("status", {
        name: "Transition",
        exact: true,
      });
      const ring = page.locator(".spinning-disc-overlay");
      await expect(indicator).toHaveText("Crossfade");
      await expect(ring).toHaveAttribute("data-mix-tone", "crossfade");
      const blue = await indicator.evaluate(
        (node) => getComputedStyle(node).color,
      );
      await expect
        .poll(() =>
          indicator
            .locator(".crate-mono-label")
            .evaluate((node) => getComputedStyle(node).color),
        )
        .toBe(blue);
      expect(
        await ring.evaluate((node) => getComputedStyle(node).borderColor),
      ).toBe(blue);
      expect(
        await ring.evaluate((node) => getComputedStyle(node).borderWidth),
      ).toBe("1px");
      const indicatorBox = await indicator.boundingBox();
      const sliderBox = await page.getByRole("slider").boundingBox();
      expect(indicatorBox!.y + indicatorBox!.height).toBeLessThanOrEqual(
        sliderBox!.y,
      );
      if (viewport.width === 393)
        await page.screenshot({ path: "/tmp/listen-mix-crossfade-oct24.png" });

      await page
        .getByRole("button", { name: "beatmatch", exact: true })
        .click();
      await expect(indicator).toHaveText("Beatmatch · Bass swap");
      const yellow = await indicator.evaluate(
        (node) => getComputedStyle(node).color,
      );
      expect(yellow).not.toBe(blue);
      expect(
        await ring.evaluate((node) => getComputedStyle(node).borderColor),
      ).toBe(yellow);
      await expect
        .poll(() =>
          indicator
            .locator(".crate-mono-label")
            .evaluate((node) => getComputedStyle(node).color),
        )
        .toBe(yellow);
      if (viewport.width === 393)
        await page.screenshot({ path: "/tmp/listen-mix-beatmatch-oct24.png" });

      await page
        .getByRole("button", { name: "Pause fixture", exact: true })
        .click();
      await expect(indicator).toHaveText("Beatmatch · Bass swap · Paused");
      await expect(ring).not.toHaveAttribute("data-mix-tone");
      await page.getByRole("button", { name: "Español", exact: true }).click();
      await expect(page.getByRole("status", { name: "Transición" })).toHaveText(
        "Beatmatch · Intercambio de graves · En pausa",
      );
      await page
        .getByRole("button", { name: "Clear telemetry", exact: true })
        .click();
      await expect(page.getByRole("status")).toHaveCount(0);
      await expect(ring).not.toHaveAttribute("data-mix-tone");

      await page.getByRole("button", { name: "gapless", exact: true }).click();
      await expect(page.getByRole("status")).toHaveText("Gapless");
      await expect(ring).not.toHaveAttribute("data-mix-tone");
      expect(
        await page
          .locator("body")
          .evaluate((node) => node.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  });
}
