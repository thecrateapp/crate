import { expect, test, type Locator, type Page } from "@playwright/test";

const href = "/blog/from-crossfades-to-a-shared-mixing-engine";
const selector = '[data-viz="blog-crossfade"]';

async function open(page: Page) {
  const response = await page.goto(href);
  test.skip(
    response?.status() === 404,
    "The crossfade article is a review draft.",
  );
  const figure = page.locator(selector);
  await expect(figure).toHaveCount(1);
  await figure.scrollIntoViewIfNeeded();
  await expect(figure).toHaveAttribute("data-ready", "true");
  return figure;
}

const pin = (figure: Locator, state: string, phase: number) =>
  figure
    .locator(`[data-bf-phases="${state}"] [data-bf-phase="${phase}"]`)
    .click();

const readout = (figure: Locator, key: string) =>
  figure.locator(`[data-cf-ro="${key}"]`);

test("the crossfade figure is readable without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const response = await page.goto(href);
  test.skip(
    response?.status() === 404,
    "The crossfade article is a review draft.",
  );
  const figure = page.locator(selector);
  await expect(figure).toHaveAttribute("data-state", "timer");
  await expect(figure.locator('[data-bf-phases="timer"]')).toContainText(
    "steps up about 3 dB",
  );
  await expect(figure.locator('[data-cf-state="timer"]')).toBeVisible();
  await expect(figure.locator('[data-cf-state="bus"]')).toBeHidden();
  await context.close();
});

test("the timer holds both gains while the UI thread is busy", async ({
  page,
}) => {
  const figure = await open(page);
  await pin(figure, "timer", 1);
  await expect(readout(figure, "ui")).toHaveText("Busy");
  await expect(figure.locator(".cf")).toHaveAttribute("data-ui", "busy");
  const held = await readout(figure, "gainA").textContent();
  await pin(figure, "timer", 2);
  await expect(readout(figure, "ui")).toHaveText("Idle");
  await expect(readout(figure, "gainA")).not.toHaveText(held!);
});

test("the PCM envelope keeps moving through the same stall", async ({
  page,
}) => {
  const figure = await open(page);
  await figure.locator('[data-bf-state="pcm"]').click();
  await pin(figure, "pcm", 1);
  await expect(readout(figure, "ui")).toHaveText("Busy");
  await expect(figure.locator('[data-cf-state="pcm"]')).toBeVisible();
  await expect(figure.locator('[data-cf-state="timer"]')).toBeHidden();
  await expect(readout(figure, "beats")).toHaveText("Not aligned");
});

test("the shared bus aligns the beats on one output", async ({ page }) => {
  const figure = await open(page);
  await figure.locator('[data-bf-state="bus"]').click();
  await pin(figure, "bus", 1);
  await expect(readout(figure, "beats")).toHaveText("Aligned");
  await expect(readout(figure, "output")).toHaveText("1 bus");
  await expect(figure.locator('[data-cf-state="bus"] .offset')).toHaveCount(0);
});

test("the playhead advances while the figure is visible", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const figure = await open(page);
  const clip = figure.locator("[data-cf-clip]");
  const start = Number(await clip.getAttribute("width"));
  await expect
    .poll(async () => Number(await clip.getAttribute("width")), {
      timeout: 8000,
    })
    .not.toBe(start);
});

test("reduced motion shows the end of each mechanism", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const figure = await open(page);
  await expect(figure).toHaveAttribute("data-phase", "3");
  await expect(readout(figure, "gainB")).toHaveText("0.0");
});

test("the crossfade figure fits a 390 px viewport", async ({ page }) => {
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
});
