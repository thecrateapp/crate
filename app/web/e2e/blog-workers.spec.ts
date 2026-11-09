import { expect, test, type Locator, type Page } from "@playwright/test";

const href = "/blog/keeping-background-work-from-interrupting-playback";
const selector = '[data-viz="blog-workers"]';

async function open(page: Page) {
  const response = await page.goto(href);
  test.skip(response?.status() === 404, "H12 is a review draft.");
  const figure = page.locator(selector);
  await expect(figure).toHaveCount(1);
  await figure.scrollIntoViewIfNeeded();
  await expect(figure).toHaveAttribute("data-ready", "true");
  return figure;
}

const pin = (figure: Locator, phase: number) =>
  figure
    .locator(`[data-bf-phases="admission"] [data-bf-phase="${phase}"]`)
    .click();

const readout = (figure: Locator, key: string) =>
  figure.locator(`[data-wk-ro="${key}"] > span`);
const tone = (figure: Locator, key: string) =>
  figure.locator(`[data-wk-ro="${key}"]`);
const job = (figure: Locator, id: string) =>
  figure.locator(`[data-wk-job="${id}"]`);

test("the admission figure is readable without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const response = await page.goto(href);
  test.skip(response?.status() === 404, "H12 is a review draft.");
  const figure = page.locator(selector);
  await expect(figure.locator('[data-bf-phases="admission"]')).toContainText(
    "same task ID",
  );
  await expect(figure).toContainText("should_defer_task");
  await expect(figure).toContainText("_should_pause_for_load");
  await expect(figure).toContainText("not governed");
  await expect(readout(figure, "governor")).toHaveText("Defer");
  await expect(readout(figure, "repair")).toHaveText("Pending");
  await expect(job(figure, "repair-next")).toHaveAttribute(
    "data-state",
    "deferred",
  );
  await expect(figure.locator("[data-bf-state]")).toHaveCount(0);
  await expect(page.locator(".prose [data-blog-visual]")).toHaveCount(0);
  await context.close();
});

test("playback prepares in its own slot before any play event counts", async ({
  page,
}) => {
  const figure = await open(page);
  await pin(figure, 0);
  await expect(figure).toHaveAttribute("data-pinned", "0");
  await expect(readout(figure, "governor")).toHaveText("Allow");
  await expect(readout(figure, "playback")).toHaveText("Preparing");
  await expect(job(figure, "variant-a")).toHaveAttribute(
    "data-state",
    "preparing",
  );
  await expect(job(figure, "repair-running")).toHaveAttribute(
    "data-state",
    "running",
  );
  await expect(figure.locator('[data-wk-count="users"]')).toHaveText("0");
});

test("the gate sends the next repair back with a delay", async ({ page }) => {
  const figure = await open(page);
  await pin(figure, 1);
  await expect(readout(figure, "governor")).toHaveText("Defer");
  await expect(tone(figure, "governor")).toHaveAttribute("data-tone", "warn");
  await expect(readout(figure, "repair")).toHaveText("Pending");
  await expect(tone(figure, "repair")).toHaveAttribute("data-tone", "warn");
  await expect(job(figure, "repair-next")).toHaveAttribute(
    "data-state",
    "deferred",
  );
  await expect(figure.locator("[data-wk-reason]")).toHaveText(
    "1 active listener(s)>0, 1 recent stream(s)>0",
  );
  await expect(job(figure, "batch-next")).toHaveAttribute(
    "data-state",
    "pending",
  );
  await expect(figure.locator("[data-wk-sleep]")).toHaveAttribute(
    "data-on",
    "true",
  );
  await expect(readout(figure, "interrupted")).toHaveText("None");
});

test("a recent play defers the same task again, then the pin resumes", async ({
  page,
}) => {
  const figure = await open(page);
  await pin(figure, 2);
  await expect(job(figure, "repair-next")).toHaveAttribute(
    "data-state",
    "deferred",
  );
  await expect(figure.locator("[data-wk-arc-label]")).toContainText("×2");
  await expect(readout(figure, "playback")).toHaveText("Free");
  await pin(figure, 2);
  await expect(figure).toHaveAttribute("data-pinned", "");
});

test("with both windows empty the same repair runs", async ({ page }) => {
  const figure = await open(page);
  await pin(figure, 3);
  await expect(readout(figure, "governor")).toHaveText("Allow");
  await expect(readout(figure, "repair")).toHaveText("Running");
  await expect(tone(figure, "repair")).toHaveAttribute("data-tone", "ok");
  await expect(job(figure, "repair-next")).toHaveAttribute(
    "data-state",
    "running",
  );
  await expect(job(figure, "batch-next")).toHaveAttribute(
    "data-state",
    "running",
  );
  await expect(figure.locator('[data-wk-count="users"]')).toHaveText("0");
  await expect(figure.locator('[data-wk-count="streams"]')).toHaveText("0");
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

test("reduced motion shows the admitted retry without looping", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const figure = await open(page);
  await expect(figure).toHaveAttribute("data-phase", "3");
  await page.waitForTimeout(600);
  await expect(figure).toHaveAttribute("data-phase", "3");
  await expect(readout(figure, "repair")).toHaveText("Running");
});

test("the admission figure fits a 390 px viewport", async ({ page }) => {
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
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
