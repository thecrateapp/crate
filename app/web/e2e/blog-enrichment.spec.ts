import { expect, test, type Locator, type Page } from "@playwright/test";

const href = "/blog/building-an-artist-page-when-the-providers-disagree";
const selector = '[data-viz="blog-enrichment"]';
const draft = "The enrichment article is a review draft.";

async function open(page: Page) {
  const response = await page.goto(href);
  test.skip(response?.status() === 404, draft);
  const figure = page.locator(selector);
  await expect(figure).toHaveCount(1);
  await figure.scrollIntoViewIfNeeded();
  await expect(figure).toHaveAttribute("data-ready", "true");
  return figure;
}

const pin = (figure: Locator, phase: number) =>
  figure.locator(`[data-bf-phases="run"] [data-bf-phase="${phase}"]`).click();

const readout = (figure: Locator, key: string) =>
  figure.locator(`[data-en-ro="${key}"]`);

const field = (figure: Locator, id: string) =>
  figure.locator(`[data-en-field="${id}"]`);

test("the enrichment figure is readable without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const response = await page.goto(href);
  test.skip(response?.status() === 404, draft);
  const figure = page.locator(selector);
  await expect(figure).toHaveCount(1);
  await expect(figure.locator('[data-bf-phases="run"]')).toContainText(
    "They take no fetch slot",
  );
  await expect(readout(figure, "bio")).toHaveText("Kept");
  await expect(field(figure, "country")).toHaveAttribute(
    "data-outcome",
    "locked",
  );
  await expect(field(figure, "country").locator("[data-en-value]")).toHaveText(
    "CA",
  );
  await expect(page.locator(".prose [data-blog-visual]")).toHaveCount(0);
  await context.close();
});

test("cache hits are parked before the misses take the three workers", async ({
  page,
}) => {
  const figure = await open(page);
  await pin(figure, 0);
  await expect(figure).toHaveAttribute("data-pinned", "0");
  await expect(readout(figure, "hits")).toHaveText("3 / 6");
  await expect(readout(figure, "payloads")).toHaveText("3 / 6");
  for (const id of ["musicbrainz", "fanart", "discogs"])
    await expect(figure.locator(`[data-en-src="${id}"]`)).toHaveAttribute(
      "data-status",
      "hit",
    );
  await expect(figure.locator("[data-en-job]")).toHaveCount(3);
  await expect(
    figure.locator('[data-en-job][data-status="queued"]'),
  ).toHaveCount(3);
});

test("responses arrive and Last.fm fails while the row stays unchanged", async ({
  page,
}) => {
  const figure = await open(page);
  await pin(figure, 1);
  await expect(readout(figure, "payloads")).toHaveText("5 / 6");
  await expect(readout(figure, "payloads")).toHaveAttribute(
    "data-tone",
    "warn",
  );
  await expect(readout(figure, "row")).toHaveText("Unchanged");
  await expect(figure.locator('[data-en-job="lastfm"]')).toHaveAttribute(
    "data-status",
    "failed",
  );
  await expect(figure.locator('[data-en-src="lastfm"]')).toHaveAttribute(
    "data-status",
    "failed",
  );
  await expect(field(figure, "bio")).toHaveAttribute("data-stage", "stored");
});

test("assembly proposes no biography and MusicBrainz's country", async ({
  page,
}) => {
  const figure = await open(page);
  await pin(figure, 2);
  await expect(readout(figure, "bio")).toHaveText("None");
  await expect(readout(figure, "bio")).toHaveAttribute("data-tone", "warn");
  await expect(field(figure, "country")).toHaveAttribute(
    "data-stage",
    "proposed",
  );
  await expect(field(figure, "country").locator("[data-en-value]")).toHaveText(
    "GB",
  );
  await expect(figure.locator('[data-en-note="musicbrainz"]')).toHaveText(
    "proposes GB",
  );
});

test("the writer keeps the biography and the locked country, and replaces tags", async ({
  page,
}) => {
  const figure = await open(page);
  await pin(figure, 3);
  await expect(readout(figure, "row")).toHaveText("Written");
  await expect(readout(figure, "bio")).toHaveText("Kept");
  await expect(readout(figure, "bio")).toHaveAttribute("data-tone", "ok");
  await expect(field(figure, "bio")).toHaveAttribute("data-outcome", "kept");
  await expect(field(figure, "country")).toHaveAttribute(
    "data-outcome",
    "locked",
  );
  await expect(field(figure, "country").locator("[data-en-value]")).toHaveText(
    "CA",
  );
  await expect(field(figure, "tags")).toHaveAttribute(
    "data-outcome",
    "replaced",
  );
  await expect(figure.locator("[data-en-stamp]")).toHaveText("now");
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

test("reduced motion shows the written row without looping", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const figure = await open(page);
  await expect(figure).toHaveAttribute("data-phase", "3");
  await page.waitForTimeout(600);
  await expect(figure).toHaveAttribute("data-phase", "3");
  await expect(readout(figure, "row")).toHaveText("Written");
});

test("the enrichment figure fits a 390 px viewport", async ({ page }) => {
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
  const right = box!.x + box!.width;
  const labels = await figure
    .locator(".en-label")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().right),
    );
  for (const edge of labels) expect(edge).toBeLessThanOrEqual(right + 1);
});
