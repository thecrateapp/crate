import { expect, test } from "@playwright/test";

test("dragging a band reshapes the curve", async ({ page }) => {
  await page.goto("/");
  const curve = page.locator("[data-eq-curve]");
  await curve.scrollIntoViewIfNeeded();
  const before = await curve.getAttribute("d");
  const band = page.locator('[data-eq-band="2"]');
  const box = await band.boundingBox();
  if (!box) throw new Error("band has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 40, { steps: 4 });
  await page.mouse.up();
  await expect(curve).not.toHaveAttribute("d", before ?? "");
  expect(Number(await band.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
});

test("arrow keys move a focused band in 0.5 dB steps", async ({ page }) => {
  await page.goto("/");
  const band = page.locator('[data-eq-band="5"]');
  await band.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(band).toHaveAttribute("aria-valuenow", "1");
  await page.keyboard.press("ArrowDown");
  await expect(band).toHaveAttribute("aria-valuenow", "0.5");
});

test("a preset chip sets the bands and drops back to Manual on a drag", async ({
  page,
}) => {
  await page.goto("/");
  const chip = page.getByRole("radio", { name: "Bass boost" });
  await chip.click();
  await expect(chip).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('[data-eq-band="0"]')).toHaveAttribute(
    "aria-valuenow",
    "6",
  );
  await page.locator('[data-eq-band="9"]').focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("radio", { name: "Manual" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("the kit toggle stops the Beam", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("switch", { name: "Beam" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#play [data-beam]")).toHaveAttribute(
    "data-running",
    "false",
  );
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("holds the cover still and the Beam centred", async ({ page }) => {
    await page.goto("/");
    const mark = page.locator("#cover [data-mark]");
    await mark.scrollIntoViewIfNeeded();
    const animations = await mark.evaluate(
      (el) =>
        el
          .getAnimations({ subtree: true })
          .filter((a) => a.playState === "running").length,
    );
    expect(animations).toBe(0);
    for (const beam of await page.locator("[data-beam]").all()) {
      await expect(beam).toHaveAttribute("data-running", "false");
      const [track, seg] = await Promise.all([
        beam.boundingBox(),
        beam.locator("[data-beam-segment]").boundingBox(),
      ]);
      if (!track || !seg) throw new Error("beam has no box");
      expect(
        Math.abs(seg.x + seg.width / 2 - (track.x + track.width / 2)),
      ).toBeLessThan(1.5);
    }
  });
});
