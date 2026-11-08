import {
  expect,
  test as base,
  type Locator,
  type Page,
} from "@playwright/test";
import { milestones } from "../src/data/engineering-timeline";

const first = "/blog/crate-started-as-a-librarian";
const second = "/blog/filesystem-to-indexed-catalogue";
const third = "/blog/taking-playback-over-from-navidrome";
const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await use(errors);
      expect(
        errors,
        "Embedded navigation must not raise browser errors",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

async function chapter(page: Page, href: string) {
  const response = await page.goto(href);
  test.skip(
    [second, third].includes(href.split("#")[0]!) && response?.status() === 404,
    "Draft chapters only render in development.",
  );
  expect(response?.status()).toBe(200);
  return page.locator("[data-series-browser]");
}

async function expectStopVisible(stop: Locator) {
  await expect
    .poll(() =>
      stop.evaluate((element) => {
        const bounds = element
          .closest("[data-track-viewport]")!
          .getBoundingClientRect();
        const selected = element.getBoundingClientRect();
        return (
          selected.left >= bounds.left - 1 && selected.right <= bounds.right + 1
        );
      }),
    )
    .toBe(true);
}

for (const [href, milestone] of [
  [first, "librarian"],
  [second, "catalog"],
  [third, "direct-streaming"],
]) {
  test(`${milestone} chapter starts at its own milestone and opens a folding navigator before the article`, async ({
    page,
  }) => {
    const browser = await chapter(page, href!);
    const track = browser.locator('[data-timeline-proposal="signal-track"]');
    await expect(browser).not.toHaveAttribute("open", "");
    await expect(browser.locator("summary")).toContainText(
      "Explore the series",
    );
    await expect(track.locator("[data-track-stop]")).toHaveCount(
      milestones.length,
    );
    await expect(track).toHaveAttribute("data-selected-milestone", milestone!);
    await expect(
      track.locator(`[data-milestone-id="${milestone}"]`),
    ).toHaveAttribute("aria-pressed", "true");
    const order = await browser.evaluate((element) => {
      const header = document.querySelector(".post-head")!;
      const body = document.querySelector(".post-body")!;
      return (
        Boolean(
          header.compareDocumentPosition(element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ) &&
        Boolean(
          element.compareDocumentPosition(body) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        )
      );
    });
    expect(order).toBe(true);
    const summary = browser.locator("summary");
    await summary.focus();
    await summary.press("Enter");
    await expect(browser).toHaveAttribute("open", "");
    await expectStopVisible(
      track.locator('[data-track-stop][aria-pressed="true"]'),
    );
    const current = track.locator("[data-track-detail]:visible .track-read");
    await expect(current).toHaveAttribute("href", "#post-content");
    await expect(current).toContainText("Continue reading");
    await current.click();
    await expect.poll(() => new URL(page.url()).hash).toBe("#post-content");
    expect(new URL(page.url()).pathname).toBe(href);
  });
}

test("timeline links connect chapters and remain interactive after Astro navigation", async ({
  page,
  request,
}) => {
  const response = await request.get(second);
  expect([200, 404]).toContain(response.status());
  test.skip(
    response.status() === 404,
    "The second chapter remains a development draft.",
  );
  let browser = await chapter(page, `${first}#series-timeline`);
  await expect(browser).toHaveAttribute("open", "");
  let track = browser.locator('[data-timeline-proposal="signal-track"]');
  await track.locator('[data-milestone-id="catalog"]').click();
  const next = track.locator("[data-track-detail]:visible .track-read");
  await expect(next).toHaveAttribute("href", second);
  await next.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(second);
  browser = page.locator("[data-series-browser]");
  track = browser.locator('[data-timeline-proposal="signal-track"]');
  await expect(track).toHaveAttribute("data-selected-milestone", "catalog");
  await browser.locator("summary").click();
  await track.locator('[data-milestone-id="librarian"]').click();
  const previous = track.locator("[data-track-detail]:visible .track-read");
  await expect(previous).toHaveAttribute("href", first);
  await previous.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(first);
  browser = page.locator("[data-series-browser]");
  await browser.locator("summary").click();
  await browser.locator("[data-track-next]").click();
  await expect(
    browser.locator('[data-timeline-proposal="signal-track"]'),
  ).toHaveAttribute("data-selected-milestone", "catalog");
  await expect(
    browser.locator("[data-track-detail]:visible .track-read"),
  ).toHaveAttribute("href", second);
});

test("mobile period jumps, folding and resizing keep the selected stop visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const browser = await chapter(page, `${first}#series-timeline`);
  await expect(browser).toHaveAttribute("open", "");
  const track = browser.locator('[data-timeline-proposal="signal-track"]');
  await track.locator("[data-track-period]").last().click();
  const active = track.locator('[data-track-stop][aria-pressed="true"]');
  await active.focus();
  await active.press("End");
  await expect(track).toHaveAttribute(
    "data-selected-milestone",
    milestones.at(-1)!.id,
  );
  await expectStopVisible(track.locator("[data-track-stop]").last());
  await expect(track).not.toHaveAttribute("data-travelling", "true");
  const outside = await browser
    .locator(
      "summary, [data-track-viewport], [data-track-period], .track-details",
    )
    .evaluateAll((elements) =>
      elements.some((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.left < -1 ||
          bounds.right > document.documentElement.clientWidth + 1
        );
      }),
    );
  expect(
    outside,
    "Navigation content must fit mobile even when the page clips overflow",
  ).toBe(false);
  const summary = browser.locator("summary");
  await summary.focus();
  await summary.press("Enter");
  await expect(browser).not.toHaveAttribute("open", "");
  await page.setViewportSize({ width: 1440, height: 1100 });
  await summary.press("Enter");
  await expect(browser).toHaveAttribute("open", "");
  await expect(track).toHaveAttribute(
    "data-selected-milestone",
    milestones.at(-1)!.id,
  );
  await expectStopVisible(track.locator("[data-track-stop]").last());
});

test("the current chapter is server rendered and standalone posts have no series navigator", async ({
  browser: chromium,
  baseURL,
  page,
}) => {
  const staticPage = await chromium.newPage({ javaScriptEnabled: false });
  try {
    const response = await staticPage.goto(`${baseURL}${first}`);
    expect(response?.status()).toBe(200);
    const browser = staticPage.locator("[data-series-browser]");
    await browser.locator("summary").click();
    await expect(
      browser.locator('[data-milestone-id="librarian"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(browser.locator("[data-track-detail]:visible h3")).toHaveText(
      milestones.find((item) => item.id === "librarian")!.title,
    );
    await expect(
      browser.locator("[data-track-detail]:visible .track-read"),
    ).toHaveAttribute("href", "#post-content");
  } finally {
    await staticPage.close();
  }
  await page.goto("/blog/reads-from-snapshots");
  await expect(page.locator("[data-series-browser]")).toHaveCount(0);
});
