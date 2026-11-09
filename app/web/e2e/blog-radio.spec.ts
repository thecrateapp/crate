import { expect, test, type Locator, type Page } from "@playwright/test";

const href = "/blog/when-a-familiar-radio-became-too-familiar";
const selector = '[data-viz="blog-radio"]';

async function open(page: Page) {
  const response = await page.goto(href);
  test.skip(response?.status() === 404, "H31 is a preview draft.");
  const figure = page.locator(selector);
  await expect(figure).toHaveCount(1);
  await figure.scrollIntoViewIfNeeded();
  await expect(figure).toHaveAttribute("data-ready", "true");
  return figure;
}

const pin = (figure: Locator, phase: number) =>
  figure
    .locator(`[data-bf-phases="selector"] [data-bf-phase="${phase}"]`)
    .click();

const reading = (figure: Locator, key: string) =>
  figure.locator(`[data-rr-ro="${key}"]`);
const text = (figure: Locator, key: string) =>
  reading(figure, key).locator("[data-rr-text]");
const row = (figure: Locator, title: string) =>
  figure.locator(`[data-rr-row$=":${title}"]`);
const chips = (figure: Locator, lane: string) =>
  figure.locator(`[data-rr-lane="${lane}"] [data-rr-chip][data-on]`);

test("the radio figure is readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const response = await page.goto(href);
  test.skip(response?.status() === 404, "H31 is a preview draft.");
  const figure = page.locator(selector);
  await expect(figure.locator('[data-bf-phases="selector"] li')).toHaveCount(4);
  await expect(figure.locator('[data-bf-phases="selector"]')).toContainText(
    "fits within 0.10 + 0.05",
  );
  await expect(row(figure, "Song (Live)")).toContainText("a · song");
  await expect(row(figure, "Fresh")).toHaveAttribute("data-pick", "queued");
  await expect(text(figure, "band")).toHaveText("≤ 0.15");
  await expect(text(figure, "queued")).toHaveText("Fresh");
  await expect(page.locator(".prose [data-blog-visual]")).toHaveCount(0);
  await context.close();
});

test("a short skip cools the song in the ledger, not in history", async ({
  page,
}) => {
  const figure = await open(page);
  await pin(figure, 0);
  await expect(figure).toHaveAttribute("data-pinned", "0");
  await expect(text(figure, "play")).toHaveText("5 s");
  await expect(chips(figure, "heard")).toHaveCount(0);
  await expect(chips(figure, "delivered")).toHaveText([
    "a · delivered x",
    "b · fresh",
  ]);
  await expect(text(figure, "best")).toHaveText("Delivered X");
  await expect(reading(figure, "best")).toHaveAttribute("data-tone", "warn");
  await expect(text(figure, "band")).toHaveText("Not used");
  await expect(text(figure, "queued")).toHaveText("Fresh");
  await expect(reading(figure, "queued")).toHaveAttribute("data-tone", "ok");
});

test("a significant listen rotates within the 0.05 band", async ({ page }) => {
  const figure = await open(page);
  await pin(figure, 1);
  await expect(text(figure, "play")).toHaveText("30 s");
  await expect(chips(figure, "heard")).toHaveText(["a · song"]);
  await expect(figure.locator(".rr")).toHaveAttribute("data-band", "applied");
  await expect(text(figure, "band")).toHaveText("≤ 0.15");
  await expect(row(figure, "Song (Live)")).toHaveAttribute(
    "data-status",
    "heard",
  );
  await expect(row(figure, "Fresh")).toHaveAttribute("data-pick", "queued");
  await expect(row(figure, "Fresh").locator("[data-rr-score]")).toHaveText(
    "0.14",
  );
});

test("the remembered song returns when nothing fresh qualifies", async ({
  page,
}) => {
  const figure = await open(page);
  await pin(figure, 2);
  await expect(row(figure, "Delivered X")).toHaveAttribute("data-pick", "kept");
  await expect(text(figure, "queued")).toHaveText("Delivered X");
  await expect(reading(figure, "queued")).toHaveAttribute("data-tone", "warn");

  await pin(figure, 3);
  await expect(row(figure, "Delivered X")).toHaveAttribute(
    "data-pick",
    "returns",
  );
  await expect(figure.locator("[data-rr-end]")).toHaveText(
    "end of pool · 1 ranked",
  );
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

test("reduced motion shows the final refill without looping", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const figure = await open(page);
  await expect(figure).toHaveAttribute("data-phase", "3");
  await page.waitForTimeout(600);
  await expect(figure).toHaveAttribute("data-phase", "3");
  await expect(text(figure, "queued")).toHaveText("Delivered X");
});

test("the radio figure fits a 390 px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const figure = await open(page);
  await pin(figure, 1);
  const box = await figure.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(
    await figure.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  const overflow = await figure.evaluate((element) => {
    const right = element.getBoundingClientRect().right + 1;
    return [
      ...element.querySelectorAll(".rr-row[data-visible] .c-check > *"),
    ].filter((cell) => cell.getBoundingClientRect().right > right).length;
  });
  expect(overflow).toBe(0);
});
