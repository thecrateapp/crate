import { expect, test } from "@playwright/test";
const hosts = [
  {
    name: "storybook",
    url: "/iframe.html?id=reviews-1ay-shell--complete&viewMode=story",
  },
  { name: "standalone", url: "http://127.0.0.1:5186/review-1ay-shell.html" },
];
for (const host of hosts) {
  test(`${host.name}: desktop navigation, URL tabs, 8px fields and flat chrome`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(host.url);
    await expect(
      page.getByRole("heading", { name: "1AY · Listen Shell" }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const header = page.getByTestId("listen-header");
    expect(
      await header.evaluate((el) => getComputedStyle(el).backdropFilter),
    ).toBe("none");
    const nav = page.getByRole("complementary");
    await nav.getByRole("button", { name: "Collection", exact: true }).click();
    const links = nav.locator("li a");
    await expect(links).toHaveCount(7);
    for (const link of await links.all())
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(
      nav.getByRole("link", { name: "Albums", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    const music = nav.getByRole("link", { name: "Music", exact: true });
    const before = await music.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    await music.hover();
    expect(
      await music.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe(before);
    expect(
      await music.evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("Poppins");
    const gaps = await page
      .locator('[data-slot="form-field"][data-layout="stacked"]')
      .evaluateAll((fields) =>
        fields.map((field) => {
          const caption = field.querySelector(
            '[data-slot="form-field-label"]',
          )!;
          const sample = caption.nextElementSibling!;
          return (
            sample.getBoundingClientRect().top -
            caption.getBoundingClientRect().bottom
          );
        }),
      );
    for (const gap of gaps) expect(gap).toBeCloseTo(8, 1);
    await page.getByRole("tab", { name: "Albums", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("tab", { name: "Liked tracks", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.waitForTimeout(450);
    await expect(
      page.getByRole("tab", { name: "Liked tracks", exact: true }),
    ).toBeFocused();
    await expect(
      page.locator('output[aria-label="Current route"]'),
    ).toContainText("/collection/liked?node=review&tab=untouched#saved");
    await page.getByRole("button", { name: "Go back", exact: true }).click();
    await expect(
      page.getByRole("tab", { name: "Albums", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page
      .getByRole("button", { name: "Collapse sidebar", exact: true })
      .click();
    const trigger = page
      .getByRole("complementary")
      .getByRole("button", { name: "Collection", exact: true });
    if ((await trigger.getAttribute("aria-expanded")) !== "true")
      await trigger.click();
    const popupLinks = page.getByRole("list", {
      name: "Collection",
      exact: true,
    });
    await expect(popupLinks).toBeVisible();
    expect(await popupLinks.evaluate((el) => el.closest("aside"))).toBeNull();
    await page.keyboard.press("Escape");
    await expect(
      page
        .getByRole("complementary")
        .getByRole("button", { name: "Collection", exact: true }),
    ).toBeFocused();
    await page.screenshot({
      path: `.artifacts/review/1ay-${host.name}-desktop.png`,
    });
  });
  test(`${host.name}: mobile sheet focus, solid dock and safe-area clearance`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(host.url);
    await expect(
      page.getByRole("heading", { name: "1AY · Listen Shell" }),
    ).toBeVisible();
    await expect(page.getByRole("tabpanel")).toHaveCount(0);
    const dock = page.locator(".listen-mobile-dock-surface");
    expect(
      await dock.evaluate((el) => getComputedStyle(el).backdropFilter),
    ).toBe("none");
    const collection = page.getByRole("button", {
      name: "Collection",
      exact: true,
    });
    expect((await collection.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await collection.click();
    const dialog = page.getByRole("dialog", {
      name: "Collection",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link")).toHaveCount(7);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(collection).toBeFocused();
    const main = page.getByRole("main");
    const noPlayer = await main.evaluate((el) =>
      parseFloat(getComputedStyle(el).paddingBottom),
    );
    await page
      .getByRole("checkbox", { name: "Player space", exact: true })
      .check();
    const withPlayer = await main.evaluate((el) =>
      parseFloat(getComputedStyle(el).paddingBottom),
    );
    expect(withPlayer - noPlayer).toBeCloseTo(66, 1);
    await page.addStyleTag({
      content:
        ":root{--listen-safe-bottom:20px;--listen-keyboard-height:100px;}",
    });
    expect(
      (await main.evaluate((el) =>
        parseFloat(getComputedStyle(el).paddingBottom),
      )) - withPlayer,
    ).toBeCloseTo(120, 1);
    await page.screenshot({
      path: `.artifacts/review/1ay-${host.name}-mobile.png`,
    });
  });
}

test("collapsed collection stays inside a short desktop viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 350 });
  await page.goto(hosts[0]!.url);
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await page
    .getByRole("complementary")
    .getByRole("button", { name: "Collection", exact: true })
    .click();
  const popup = page
    .getByRole("list", { name: "Collection", exact: true })
    .locator("..");
  await expect(popup).toBeVisible();
  const box = (await popup.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(350);
  await page.getByRole("link", { name: "Contributions", exact: true }).focus();
  await expect(
    page.getByRole("link", { name: "Contributions", exact: true }),
  ).toBeInViewport();
});
for (const host of hosts)
  test(`${host.name}: liked controls align and fixed sort survives selection`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(host.url);
    await page.getByRole("tab", { name: "Liked tracks", exact: true }).click();
    const play = page
      .getByRole("button", { name: "Play All", exact: true })
      .first();
    const search = page.getByRole("searchbox", {
      name: "Filter liked tracks...",
      exact: true,
    });
    const sort = page.getByRole("combobox", {
      name: "Sort liked tracks: Recently added",
      exact: true,
    });
    await expect(sort).toBeVisible();
    const playBox = (await play.boundingBox())!,
      searchBox = (await search.boundingBox())!,
      sortBox = (await sort.boundingBox())!;
    expect(playBox.y + playBox.height).toBeCloseTo(
      searchBox.y + searchBox.height,
      0,
    );
    expect(playBox.y + playBox.height).toBeCloseTo(
      sortBox.y + sortBox.height,
      0,
    );
    await sort.click();
    await page.getByRole("option", { name: "Title", exact: true }).click();
    expect(
      (await page
        .getByRole("combobox", {
          name: "Sort liked tracks: Title",
          exact: true,
        })
        .boundingBox())!.width,
    ).toBeCloseTo(sortBox.width, 1);
    await expect(
      page.getByRole("tab", { name: "Playlists", exact: true }),
    ).toHaveAccessibleDescription("0");
    await page.screenshot({
      path: `.artifacts/review/1ay-${host.name}-liked.png`,
    });
  });
