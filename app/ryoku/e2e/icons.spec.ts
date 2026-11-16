import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("the icons section sits between Crate UI and What is Crate", async ({
  page,
}) => {
  const order = await page.evaluate(() =>
    [...document.querySelectorAll("section[id]")]
      .map((section) => section.id)
      .filter((id) => ["crate-ui", "icons", "what-is-crate"].includes(id)),
  );
  expect(order).toEqual(["crate-ui", "icons", "what-is-crate"]);
  await expect(page.locator("#icons h2")).toHaveText(
    "Every app, drawn the Crate way.",
  );
});

test("every icon loads and is named for screen readers", async ({ page }) => {
  const icons = page.locator("#icons .icons img");
  expect(await icons.count()).toBeGreaterThanOrEqual(12);
  await expect(page.locator('#icons img[alt="Discord"]')).toHaveCount(1);
  await expect(page.locator('#icons img[alt="Spotify"]')).toHaveCount(0);
  for (const icon of await icons.all()) {
    await icon.scrollIntoViewIfNeeded();
    expect((await icon.getAttribute("alt"))?.length).toBeGreaterThan(1);
    await expect
      .poll(() =>
        icon.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true);
  }
});

test("the icons sit on the page, with no plate or frame", async ({ page }) => {
  const styles = await page.locator("#icons .icons").evaluate((list) => {
    const own = getComputedStyle(list);
    const item = getComputedStyle(list.querySelector("li")!);
    return [
      own.backgroundColor,
      own.borderTopWidth,
      item.backgroundColor,
      item.borderTopWidth,
    ];
  });
  expect(styles).toEqual([
    "rgba(0, 0, 0, 0)",
    "0px",
    "rgba(0, 0, 0, 0)",
    "0px",
  ]);
});

test("the four rules name the icon sources", async ({ page }) => {
  await expect(page.locator("#icons .rules .label")).toHaveText([
    "Solar glyphs",
    "Brand marks",
    "Graded fallback",
    "Always current",
  ]);
});

test("the footer credits Tabler Icons and Simple Icons next to Solar", async ({
  page,
}) => {
  const credits = page.locator("#footer .credits");
  await expect(credits).toContainText("Solar (CC BY 4.0)");
  await expect(credits).toContainText("Tabler Icons (MIT)");
  await expect(credits).toContainText("Simple Icons (CC0)");
});
