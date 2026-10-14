import { expect, test, type Page } from "@playwright/test";

const PENDING_ASSETS = ["/data/library-cloud.json"];

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const url = message.location().url;
    if (url && PENDING_ASSETS.includes(new URL(url).pathname)) return;
    errors.push(message.text());
  });
  return errors;
}

async function follow(page: Page, name: string, path: RegExp) {
  await page.locator(".nav").getByRole("link", { name, exact: true }).click();
  await expect(page).toHaveURL(path);
  await expect(page.locator("main#main")).toHaveCount(1);
}

async function snapshot(page: Page) {
  return page.evaluate(() => ({
    canvases: document.querySelectorAll("canvas").length,
    fields: document.querySelectorAll("canvas#field").length,
    spacers: document.querySelectorAll(".pin-spacer").length,
    js: document.documentElement.classList.contains("js"),
  }));
}

async function heroReactsToScroll(page: Page) {
  await expect(page.locator(".mark-static")).toHaveCSS("opacity", "0", {
    timeout: 5000,
  });
  await page.evaluate(() => scrollTo(0, innerHeight * 0.3));
  await expect
    .poll(() =>
      page
        .locator(".hero-copy")
        .evaluate((el) => +getComputedStyle(el).opacity),
    )
    .toBeLessThan(0.5);
  await page.evaluate(() => scrollTo(0, 0));
  await expect
    .poll(() =>
      page
        .locator(".hero-copy")
        .evaluate((el) => +getComputedStyle(el).opacity),
    )
    .toBeGreaterThan(0.95);
}

test("client-side round trips keep one live hero and no leaked canvases", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await heroReactsToScroll(page);
  const first = await snapshot(page);
  await page.evaluate(() => {
    (window as unknown as { roundTrip: boolean }).roundTrip = true;
  });

  for (let trip = 0; trip < 2; trip++) {
    await follow(page, "Listen", /\/listen$/);
    await expect(page.locator(".dive-canvas")).toHaveCount(2);
    await expect(page.locator("canvas#field")).toHaveCount(0);
    await follow(page, "Architecture", /\/architecture$/);
    await expect(page.locator("canvas")).toHaveCount(0);
    await page.locator(".nav .brand").click();
    await expect(page).toHaveURL(/\/$/);

    expect(await snapshot(page)).toEqual(first);
    await heroReactsToScroll(page);
  }

  expect(
    await page.evaluate(
      () => (window as unknown as { roundTrip?: boolean }).roundTrip,
    ),
  ).toBe(true);
  expect(first).toMatchObject({ fields: 1, js: true });
  expect(errors).toEqual([]);
});

test("the architecture trace still follows the scroll after a round trip", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/architecture");
  await follow(page, "Listen", /\/listen$/);
  await follow(page, "Architecture", /\/architecture$/);

  const trace = page.locator("[data-trace]");
  await expect(trace).toHaveClass(/is-live/);
  await expect(trace.locator(".trace-step").first()).toHaveClass(/is-active/);
  await trace.evaluate((el) =>
    scrollTo(
      0,
      el.getBoundingClientRect().top +
        scrollY +
        el.offsetHeight -
        innerHeight -
        4,
    ),
  );
  await expect(trace.locator(".trace-step").last()).toHaveClass(/is-active/);
  await expect(trace.locator(".trace-step.is-active")).toHaveCount(1);
  expect(await trace.locator(".edge-hl.is-past").count()).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
