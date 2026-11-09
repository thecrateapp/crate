import { expect, test, type Locator, type Page } from "@playwright/test";

const href = "/blog/moving-playback-from-one-device-to-another";
const selector = '[data-viz="blog-connect"]';

async function open(page: Page) {
  const response = await page.goto(href);
  test.skip(response?.status() === 404, "H17 is a preview draft.");
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
  figure.locator(`[data-cn-ro="${key}"]`);

test("Connect is readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const response = await page.goto(href);
  test.skip(response?.status() === 404, "H17 is a preview draft.");
  const figure = page.locator(selector);
  await expect(figure.locator('[data-bf-phases="v2"]')).toContainText(
    "Ready is not playing",
  );
  await expect(readout(figure, "desktop")).toHaveText("Queue applied");
  await expect(readout(figure, "owner")).toHaveText("Phone");
  await expect(page.locator(".prose [data-blog-visual]")).toHaveCount(0);
  await context.close();
});

test("v2 is ready while the phone still owns and plays", async ({ page }) => {
  const figure = await open(page);
  await pin(figure, "v2", 1);
  await expect(figure).toHaveAttribute("data-pinned", "1");
  await expect(readout(figure, "owner")).toHaveText("Phone");
  await expect(readout(figure, "sound")).toHaveText("Phone");
  await expect(readout(figure, "desktop")).toHaveText("Queue applied");
  await expect(figure.locator('[data-cn-packet="transfer_ready"]')).toHaveCSS(
    "opacity",
    "1",
  );
});

test("v2 commits ownership before the desktop plays", async ({ page }) => {
  const figure = await open(page);
  await pin(figure, "v2", 2);
  await expect(readout(figure, "owner")).toHaveText("Desktop");
  await expect(readout(figure, "desktop")).toHaveText("Queue applied");
  await expect(figure.locator("[data-cn-record]")).toContainText("v42");
});

test("v1 plays both devices until the phone is stopped", async ({ page }) => {
  const figure = await open(page);
  await figure.locator('[data-bf-state="v1"]').click();
  await expect(figure).toHaveAttribute("data-state", "v1");
  await expect(figure.locator('[data-bf-phases="v1"]')).toBeVisible();
  await expect(figure.locator('[data-bf-phases="v2"]')).toBeHidden();
  await pin(figure, "v1", 1);
  await expect(readout(figure, "sound")).toHaveText("Phone + Desktop");
  await expect(readout(figure, "sound")).toHaveAttribute("data-tone", "warn");
  await pin(figure, "v1", 1);
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

test("reduced motion shows the final phase without looping", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const figure = await open(page);
  await expect(figure).toHaveAttribute("data-phase", "3");
  await page.waitForTimeout(600);
  await expect(figure).toHaveAttribute("data-phase", "3");
  await expect(readout(figure, "sound")).toHaveText("Desktop");
});

test("Connect fits a 390 px viewport", async ({ page }) => {
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
