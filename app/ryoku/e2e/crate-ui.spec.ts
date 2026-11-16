import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("Crate UI shows its five rules in order, each with an example", async ({
  page,
}) => {
  const blocks = page.locator("#crate-ui .block");
  await expect(blocks).toHaveCount(5);
  await expect(page.locator("#crate-ui .block .label")).toHaveText([
    "One accent",
    "Hairlines, not boxes",
    "Display and mono",
    "One glass",
    "Icons",
  ]);
  for (const block of await blocks.all()) {
    await expect(block.locator(".text")).not.toBeEmpty();
    await expect(block.locator(".example > *")).toHaveCount(1);
  }
});

test("the icons block names the graded fallback, the watcher and Papirus", async ({
  page,
}) => {
  const note = page.locator('[data-block="icons"] .note');
  await expect(note).toContainText("keeps its own icon in Crate's colours");
  await expect(note).toContainText("watcher");
  await expect(note).toContainText("Papirus");
});

test("there is no separate icons section any more", async ({ page }) => {
  await expect(page.locator("#icons")).toHaveCount(0);
  await expect(page.locator('header.nav a[href="#icons"]')).toHaveCount(0);
});

test("one accent: only the on switch, the picked chip and the beam are cyan", async ({
  page,
}) => {
  const strip = page.locator('[data-block="accent"] .strip');
  const cyan = "rgb(103, 232, 249)";
  await expect(strip.locator(".switch.is-on")).toHaveCSS(
    "background-color",
    cyan,
  );
  await expect(strip.locator(".chip.is-on")).toHaveCSS(
    "background-color",
    cyan,
  );
  await expect(strip.locator(".chip:not(.is-on)")).toHaveCount(2);
  for (const chip of await strip.locator(".chip:not(.is-on)").all()) {
    await expect(chip).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
});

test("hairlines: the settings group is a top rule with no fill", async ({
  page,
}) => {
  const group = page.locator('[data-block="hairlines"] .group');
  await expect(group).toHaveCSS("border-top-width", "1px");
  await expect(group).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(group.locator(".group-row")).toHaveCount(3);
});

test("the type specimen uses Crate's display and mono families", async ({
  page,
}) => {
  const clock = page.locator('[data-block="type"] .clock');
  await expect(clock).toHaveText("16:42");
  expect(await clock.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(
    /^"?Bricolage Grotesque/,
  );
  await expect(clock).toHaveCSS("font-weight", "800");
  const date = page.locator('[data-block="type"] .date');
  await expect(date).toHaveText(/MONDAY · 16 NOV 2026/i);
  expect(await date.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(
    /^"?JetBrains Mono/,
  );
  await expect(date).toHaveCSS("text-transform", "uppercase");
  await expect(date.locator("b")).toHaveCSS("color", "rgb(103, 232, 249)");
});

test("one glass: a frosted panel over part of a Crate window", async ({
  page,
  request,
}) => {
  const stage = page.locator('[data-block="glass"] .stage');
  const glass = stage.locator(".glass");
  expect(
    await glass.evaluate((el) => getComputedStyle(el).backdropFilter),
  ).toMatch(/blur\((1[8-9]|2[0-4])px\)/);
  await expect(glass).toHaveCSS("border-top-left-radius", "6px");
  await expect(glass).toHaveCSS("border-top-width", "1px");
  await expect(glass).toHaveCSS("background-color", "rgba(17, 18, 24, 0.68)");
  expect(
    await stage.evaluate((el) => getComputedStyle(el).backgroundImage),
  ).toContain("/crate-ui/crate-window.webp");

  // The panel covers only part of the window: the same app shows sharp beside it.
  await stage.scrollIntoViewIfNeeded();
  const outer = (await stage.boundingBox())!;
  const inner = (await glass.boundingBox())!;
  expect(inner.x).toBeGreaterThan(outer.x + outer.width * 0.15);
  expect(inner.y).toBeGreaterThan(outer.y + outer.height * 0.15);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width);
  expect(inner.width * inner.height).toBeLessThan(
    outer.width * outer.height * 0.5,
  );

  const backdrop = await request.get("/crate-ui/crate-window.webp");
  expect(backdrop.status()).toBe(200);
  expect(backdrop.headers()["content-type"]).toContain("image/webp");
  expect((await backdrop.body()).length).toBeLessThan(80_000);
});

test("the icons load, are named, and sit on the page with no plate", async ({
  page,
}) => {
  const list = page.locator('[data-block="icons"] .icons');
  const icons = list.locator("img");
  expect(await icons.count()).toBeGreaterThanOrEqual(12);
  await expect(list.locator('img[alt="Discord"]')).toHaveCount(1);
  await expect(list.locator('img[alt="Spotify"]')).toHaveCount(0);
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
  for (const target of [list, list.locator("li").first()]) {
    await expect(target).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(target).toHaveCSS("border-top-width", "0px");
  }
});

test("the footer credits Tabler Icons and Simple Icons next to Solar", async ({
  page,
}) => {
  const credits = page.locator("#footer .credits");
  await expect(credits).toContainText("Solar (CC BY 4.0)");
  await expect(credits).toContainText("Tabler Icons (MIT)");
  await expect(credits).toContainText("Simple Icons (CC0)");
});
