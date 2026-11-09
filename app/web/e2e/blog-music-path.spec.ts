import { expect, test, type Locator, type Page } from "@playwright/test";

const href = "/blog/building-a-route-through-the-music-collection";
const selector = '[data-viz="blog-music-paths"]';

async function open(page: Page) {
  const response = await page.goto(href);
  test.skip(response?.status() === 404, "H11 is a review draft.");
  const figure = page.locator(selector);
  await expect(figure).toHaveCount(1);
  await figure.scrollIntoViewIfNeeded();
  await expect(figure).toHaveAttribute("data-ready", "true");
  return figure;
}

const pin = (figure: Locator, phase: number) =>
  figure
    .locator(`[data-bf-phases="anchor-first"] [data-bf-phase="${phase}"]`)
    .click();

const readout = (figure: Locator, key: string) =>
  figure.locator(`[data-mp-ro="${key}"]`);

const lane = (figure: Locator, index: number) =>
  figure.locator(`[data-mp-lane="${index}"]`);

test("Music Paths is readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const response = await page.goto(href);
  test.skip(response?.status() === 404, "H11 is a review draft.");
  const figure = page.locator(selector);
  await expect(figure.locator('[data-bf-phases="anchor-first"]')).toContainText(
    "song family join the used sets",
  );
  await expect(readout(figure, "destination")).toHaveText("Reserved");
  await expect(readout(figure, "family")).toContainText("2 / 5");
  await expect(readout(figure, "sparse")).toContainText("18 empty");
  await expect(
    lane(figure, 2).locator('[data-mp-slot][data-state="empty"]'),
  ).toHaveCount(18);
  await expect(page.locator(".prose [data-blog-visual]")).toHaveCount(0);
  await context.close();
});

test("every destination is reserved before the middle is searched", async ({
  page,
}) => {
  const figure = await open(page);
  await pin(figure, 0);
  await expect(figure).toHaveAttribute("data-pinned", "0");
  await expect(figure.locator('[data-mp-destination][data-state="reserved"]')).toHaveCount(3);
  await expect(figure.locator('[data-mp-slot]:not([data-state="todo"])')).toHaveCount(0);
  await expect(readout(figure, "complete")).toContainText("1 / 5");
  await expect(readout(figure, "sparse")).toContainText("1 / 20");
  await expect(readout(figure, "destination")).toHaveText("Reserved");
  await expect(lane(figure, 1).locator('[data-mp-chip="3"]')).toHaveAttribute(
    "data-state",
    "excluded",
  );
});

test("step 1 skips the destination's live version", async ({ page }) => {
  const figure = await open(page);
  await pin(figure, 1);
  const family = lane(figure, 1);
  await expect(family.locator('[data-mp-pill="3"]')).toHaveAttribute("data-state", "excluded");
  await expect(family.locator('[data-mp-pill="3"]')).toContainText("Destination (Live)");
  await expect(family.locator('[data-mp-pill="4"]')).toHaveAttribute("data-state", "selected");
  await expect(figure.locator('[data-mp-drop="1"]')).toHaveCSS("opacity", "1");
});

test("empty steps stay visible and the destination is appended last", async ({
  page,
}) => {
  const figure = await open(page);
  await pin(figure, 2);
  await expect(lane(figure, 1).locator('[data-mp-slot][data-state="empty"]')).toHaveCount(2);
  await expect(lane(figure, 2).locator('[data-mp-slot][data-state="empty"]')).toHaveCount(18);
  await expect(readout(figure, "destination")).toHaveText("Reserved");
  await expect(readout(figure, "sparse")).toHaveAttribute("data-tone", "warn");

  await pin(figure, 3);
  await expect(readout(figure, "complete")).toContainText("5 / 5");
  await expect(readout(figure, "complete")).toHaveAttribute("data-tone", "ok");
  await expect(readout(figure, "family")).toContainText("3 / 5");
  await expect(readout(figure, "family")).toHaveAttribute("data-tone", "warn");
  await expect(readout(figure, "sparse")).toContainText("2 / 20");
  await expect(readout(figure, "destination")).toHaveText("Appended");
  await expect(figure.locator('[data-mp-destination][data-state="appended"]')).toHaveCount(3);

  await pin(figure, 3);
  await expect(figure).toHaveAttribute("data-pinned", "");
});

test("the loop advances while visible and remounts after Astro navigation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const figure = await open(page);
  const first = await figure.getAttribute("data-phase");
  await expect
    .poll(() => figure.getAttribute("data-phase"), { timeout: 8000 })
    .not.toBe(first);
  await page.locator('article a[href="/blog"]').first().click();
  await page.locator(`a[href="${href}"]`).first().click();
  const remounted = page.locator(selector);
  await remounted.scrollIntoViewIfNeeded();
  await expect(remounted).toHaveAttribute("data-ready", "true");
});

test("reduced motion shows the returned routes without looping", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const figure = await open(page);
  await expect(figure).toHaveAttribute("data-phase", "3");
  await page.waitForTimeout(600);
  await expect(figure).toHaveAttribute("data-phase", "3");
  await expect(readout(figure, "family")).toContainText("3 / 5");
});

test("Music Paths fits a 390 px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const figure = await open(page);
  const box = await figure.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(
    await figure.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  for (const label of await figure.locator(".mp-pool, .mp-label, .mp-axis").all()) {
    const rect = (await label.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(box!.x - 1);
    expect(rect.x + rect.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
  }
});
