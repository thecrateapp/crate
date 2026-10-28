import { expect, test } from "@playwright/test";

test("tabs underline travels with a spring and settles under the selected option", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?id=components-tabs--moving-underline&viewMode=story",
  );
  const list = page.getByRole("tablist", {
    name: "Moving collection underline",
  });
  const line = list.locator('[data-slot="tabs-indicator"]');
  const first = page.getByRole("tab", { name: "Artists", exact: true });
  await expect(list).toHaveAttribute("data-indicator-ready", "true");
  expect((await line.boundingBox())!.x).toBeCloseTo(
    (await first.boundingBox())!.x,
    0,
  );
  const target = page.getByRole("tab", { name: "Contributions", exact: true });
  await target.click();
  await expect
    .poll(() => line.evaluate((el) => el.getAnimations().length))
    .toBeGreaterThan(0);
  await line.evaluate((el) => {
    for (const animation of el.getAnimations()) {
      animation.pause();
      animation.currentTime = 117;
    }
  });
  // spring-snappy exceeds its destination, then converges; the line never controls focus.
  expect((await line.boundingBox())!.x).toBeGreaterThan(
    (await target.boundingBox())!.x,
  );
  await expect(target).toBeFocused();
  await line.evaluate((el) => {
    for (const animation of el.getAnimations()) animation.finish();
  });
  expect((await line.boundingBox())!.x).toBeCloseTo(
    (await target.boundingBox())!.x,
    0,
  );
  expect((await line.boundingBox())!.width).toBeCloseTo(
    (await target.boundingBox())!.width,
    0,
  );
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.getByRole("tab", { name: "Liked tracks", exact: true }),
  ).toBeFocused();
});

test("tabs reduced motion follows OS and Crate preferences without a flight", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(
    "/iframe.html?id=components-tabs--moving-underline&viewMode=story",
  );
  const list = page.getByRole("tablist");
  const line = list.locator('[data-slot="tabs-indicator"]');
  await expect(list).toHaveAttribute("data-indicator-ready", "true");
  await page.getByRole("tab", { name: "Albums", exact: true }).click();
  expect(
    await line.evaluate((el) =>
      parseFloat(getComputedStyle(el).transitionDuration),
    ),
  ).toBeLessThanOrEqual(0.0001);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(
    () => (document.documentElement.dataset.crateMotion = "reduced"),
  );
  await page.getByRole("tab", { name: "Contributions", exact: true }).click();
  expect(
    await line.evaluate((el) =>
      parseFloat(getComputedStyle(el).transitionDuration),
    ),
  ).toBeLessThanOrEqual(0.0001);
  expect((await line.boundingBox())!.x).toBeCloseTo(
    (await page
      .getByRole("tab", { name: "Contributions", exact: true })
      .boundingBox())!.x,
    0,
  );
});

test("tabs indicator follows vertical, RTL and overflowing resized lists", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/iframe.html?id=components-tabs--vertical&viewMode=story");
  const list = page.getByRole("tablist");
  const line = list.locator('[data-slot="tabs-indicator"]');
  await page.getByRole("tab", { name: "Albums", exact: true }).click();
  await expect(list).toHaveAttribute("data-moving-indicator", "true");
  const tab = (await page
    .getByRole("tab", { name: "Albums", exact: true })
    .boundingBox())!;
  expect((await line.boundingBox())!.y).toBeCloseTo(tab.y, 0);
  expect((await line.boundingBox())!.height).toBeCloseTo(tab.height, 0);
  await page.goto(
    "/iframe.html?id=components-tabs--moving-underline&viewMode=story",
  );
  await page
    .getByRole("tablist")
    .evaluate((el) => el.setAttribute("dir", "rtl"));
  await page.setViewportSize({ width: 320, height: 700 });
  const target = page.getByRole("tab", { name: "Contributions", exact: true });
  await target.click();
  await expect
    .poll(async () =>
      Math.abs(
        (await page.locator('[data-slot="tabs-indicator"]').boundingBox())!.x -
          (await target.boundingBox())!.x,
      ),
    )
    .toBeLessThan(1);
  expect(
    (await page.locator('[data-slot="tabs-indicator"]').boundingBox())!.width,
  ).toBeCloseTo((await target.boundingBox())!.width, 0);
});
