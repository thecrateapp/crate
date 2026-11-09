import { expect, test, type Locator, type Page } from "@playwright/test";

const href = "/blog/giving-smart-mix-a-sense-of-musical-structure";
const selector = '[data-viz="blog-smart-mix"]';

async function open(page: Page) {
  const response = await page.goto(href);
  test.skip(
    response?.status() === 404,
    "The Smart Mix article is a review draft.",
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
  figure.locator(`[data-sm-ro="${key}"]`);

const scene = (figure: Locator) => figure.locator(".sm");

test("the Smart Mix figure is readable without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const response = await page.goto(href);
  test.skip(
    response?.status() === 404,
    "The Smart Mix article is a review draft.",
  );
  const figure = page.locator(selector);
  await expect(figure).toHaveAttribute("data-state", "v3");
  await expect(figure.locator('[data-bf-phases="v3"]')).toContainText(
    "92.16 s of A stay unplayed",
  );
  await expect(scene(figure)).toHaveAttribute("data-plan", "v3");
  await expect(figure.locator('[data-sm-mix="v3"]')).toBeVisible();
  await expect(figure.locator('[data-sm-mix="v2"]')).toBeHidden();
  await expect(readout(figure, "aUnplayed")).toHaveText("92.16");
  await expect(readout(figure, "clash")).toHaveText("0.00");
  await expect(figure.locator('[data-sm-range="a"]')).toHaveText(
    "108.00–138.72 s",
  );
  await context.close();
});

test("v3 scores v2's plan with its clash, then exits from the break", async ({
  page,
}) => {
  const figure = await open(page);
  await pin(figure, "v3", 1);
  await expect(scene(figure)).toHaveAttribute("data-plan", "v2");
  await expect(readout(figure, "clash")).toHaveText("19.42");
  await expect(figure.locator('[data-sm-dd="clash"]')).toHaveAttribute(
    "data-tone",
    "warn",
  );
  await expect(scene(figure)).toHaveAttribute("data-clash", "on");

  await pin(figure, "v3", 3);
  await expect(scene(figure)).toHaveAttribute("data-plan", "v3");
  await expect(readout(figure, "clash")).toHaveText("0.00");
  await expect(figure.locator('[data-sm-dd="clash"]')).toHaveAttribute(
    "data-tone",
    "ok",
  );
  await expect(readout(figure, "aUnplayed")).toHaveText("92.16");
  await expect(figure.locator('[data-sm-range="a"]')).toHaveText(
    "108.00–138.72 s",
  );
});

test("the runner-up skips B's intro and misses one phrase boundary", async ({
  page,
}) => {
  const figure = await open(page);
  await pin(figure, "v3", 2);
  await expect(scene(figure)).toHaveAttribute("data-plan", "alternative");
  await expect(readout(figure, "bSkipped")).toHaveText("30.72");
  await expect(readout(figure, "aUnplayed")).toHaveText("15.36");
  await expect(readout(figure, "aligned")).toHaveText("3 / 4");
  await expect(figure.locator('[data-sm-edge="1"]')).toHaveAttribute(
    "data-aligned",
    "false",
  );
  await expect(figure.locator('[data-sm-mix-detail]')).toHaveText(
    "8 bars · 15.36 s",
  );
});

test("the default v2 plan clashes and keeps all the music", async ({
  page,
}) => {
  const figure = await open(page);
  await figure.locator('[data-bf-state="v2"]').click();
  await expect(figure).toHaveAttribute("data-state", "v2");
  await pin(figure, "v2", 0);
  await expect(scene(figure)).toHaveAttribute("data-structure", "off");
  await expect(scene(figure)).toHaveAttribute("data-cues", "on");
  await expect(readout(figure, "clash")).toHaveText("—");
  await pin(figure, "v2", 1);
  await expect(readout(figure, "clash")).toHaveText("19.42");
  await pin(figure, "v2", 2);
  await expect(readout(figure, "aUnplayed")).toHaveText("0.00");
  await expect(readout(figure, "bSkipped")).toHaveText("0.00");
  await expect(figure.locator('[data-sm-range="a"]')).toHaveText(
    "200.16–230.88 s",
  );
});

test("without structure v3 returns v2's plan and the clash is unknown", async ({
  page,
}) => {
  const figure = await open(page);
  await figure.locator('[data-bf-state="no-structure"]').click();
  await pin(figure, "no-structure", 2);
  await expect(scene(figure)).toHaveAttribute("data-structure", "off");
  await expect(scene(figure)).toHaveAttribute("data-voice", "unknown");
  await expect(readout(figure, "clash")).toHaveText("Unknown");
  await expect(readout(figure, "aligned")).toHaveText("4 / 4");
  await expect(figure.locator('[data-sm-unit="aligned"]')).toHaveText("grid");
  await expect(figure.locator('[data-sm-range="a"]')).toHaveText(
    "200.16–230.88 s",
  );
  await expect(figure.locator(".voice-tag")).toBeVisible();
});

test("the window moves while the figure is visible", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const figure = await open(page);
  const clip = figure.locator('[data-sm-clip="aWin"]');
  const start = await clip.getAttribute("x");
  await expect
    .poll(async () => figure.getAttribute("data-phase"), { timeout: 12000 })
    .not.toBe("0");
  await expect
    .poll(async () => clip.getAttribute("x"), { timeout: 12000 })
    .not.toBe(start);
});

test("reduced motion shows v3's first choice without looping", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const figure = await open(page);
  await expect(figure).toHaveAttribute("data-phase", "3");
  await page.waitForTimeout(600);
  await expect(figure).toHaveAttribute("data-phase", "3");
  await expect(readout(figure, "aUnplayed")).toHaveText("92.16");
});

test("the Smart Mix figure fits a 390 px viewport", async ({ page }) => {
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
