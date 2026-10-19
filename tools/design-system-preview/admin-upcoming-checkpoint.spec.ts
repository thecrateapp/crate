import { test, expect, type Page, type Locator } from "@playwright/test";
async function open(page: Page) {
  await page.clock.setFixedTime(new Date("2026-10-18T12:00:00Z"));
  const errors: string[] = [],
    unexpected: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (
      u.pathname.startsWith("/api/") ||
      (!["127.0.0.1", "localhost"].includes(u.hostname) &&
        u.protocol !== "data:")
    )
      unexpected.push(r.url());
  });
  await page.goto("/admin-upcoming-demo.html");
  const root = page.getByRole("region", {
    name: "Página real de Upcoming",
    exact: true,
  });
  await expect(
    root.getByRole("link", { name: "Luz de octubre", exact: true }),
  ).toBeVisible();
  return { root, errors, unexpected };
}
async function gaps(root: Locator) {
  for (const field of await root.locator(".crate-form-field").all())
    expect(
      await field.evaluate((e) => {
        const [l, v] = Array.from(e.children);
        return (
          v!.getBoundingClientRect().top - l!.getBoundingClientRect().bottom
        );
      }),
    ).toBe(8);
}
const finish = (page: Page) =>
  page.getByRole("button", {
    name: "Completar acción o lectura de muestra",
    exact: true,
  });
for (const width of [1440, 768, 390])
  test(`Upcoming specimen ${width}: actual list/card/calendar/popover and local actions`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    const { root, errors, unexpected } = await open(page);
    await page.waitForFunction(() => document.fonts.status === "loaded");
    expect(
      await root
        .getByRole("heading", { name: "Upcoming", exact: true })
        .evaluate((e) => getComputedStyle(e).fontFamily),
    ).toContain("Bricolage");
    await gaps(root);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const search = root.getByRole("textbox", { name: "Artist", exact: true });
    await search.fill("Luz Polar");
    await expect(
      root.getByRole("link", { name: "Luz de octubre", exact: true }),
    ).toHaveCount(0);
    await search.fill("");
    await root
      .getByRole("combobox", { name: "All cities", exact: true })
      .click();
    await page.getByRole("option", { name: /Valencia/ }).click();
    await expect(root.getByText("Sala Centro", { exact: true })).toHaveCount(0);
    await root
      .getByRole("combobox", { name: "All cities", exact: true })
      .click();
    await page.getByRole("option", { name: "All cities", exact: true }).click();
    const show = root
      .locator('[role="button"][aria-expanded="false"]')
      .filter({ hasText: "Sala Puerto" });
    await show.press("Enter");
    await expect(
      root.getByRole("button", { name: "Close show details", exact: true }),
    ).toBeVisible();
    await expect(
      root.getByRole("link", { name: "Get Tickets", exact: true }),
    ).toHaveAttribute("href", /^\/admin-upcoming-demo.html\?destino=/);
    await root
      .getByRole("button", { name: "Close show details", exact: true })
      .click();
    await root.getByRole("button", { name: "Calendar", exact: true }).click();
    await expect(
      root.locator('[data-admin-ux="upcoming-previous"]'),
    ).toBeVisible();
    await root.getByRole("button", { name: "Next month", exact: true }).click();
    await root
      .getByRole("button", { name: "Previous month", exact: true })
      .click();
    // Calendar has two Costa Norte release buttons and the show; the show is the24th.
    await root
      .getByRole("button", { name: "Costa Norte", exact: true })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: "Download", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await root
      .getByRole("button", { name: "Costa Norte", exact: true })
      .last()
      .click();
    await expect(
      page.getByRole("button", { name: "View full details", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "View full details", exact: true })
      .click();
    await expect(
      root.getByRole("button", { name: "Close show details", exact: true }),
    ).toBeVisible();
    await root
      .getByRole("button", { name: "Close show details", exact: true })
      .click();
    await root
      .getByRole("button", { name: "Download release", exact: true })
      .click();
    await finish(page).click();
    await expect(
      root.getByRole("button", { name: "Download release", exact: true }),
    ).toHaveCount(0);
    await root
      .getByRole("button", { name: "Dismiss release", exact: true })
      .click();
    await finish(page).click();
    await expect(root.getByText("Niebla", { exact: true })).toHaveCount(0);
    await expect(
      root.locator('[data-admin-ux="upcoming-download-loading"]'),
    ).toHaveCount(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  });
test("Upcoming pending/failure, loading/empty and actual capability differences", async ({
  page,
}) => {
  const { root, errors, unexpected } = await open(page);
  await page.getByRole("radio", { name: "Adquisición", exact: true }).click();
  await expect(
    root.getByRole("button", { name: "Sync shows", exact: true }),
  ).toHaveCount(0);
  await expect(
    root.getByRole("button", { name: "Clear caches", exact: true }),
  ).toHaveCount(0);
  await expect(
    root.getByRole("button", { name: "Dismiss release", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "Fallar la siguiente acción", exact: true })
    .check();
  await root
    .getByRole("button", { name: "Download release", exact: true })
    .click();
  await finish(page).click();
  await expect(
    page.getByText("Download failed", { exact: true }),
  ).toBeVisible();
  await expect(
    root.getByRole("button", { name: "Download release", exact: true }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Conciertos", exact: true }).click();
  await expect(
    root.getByRole("button", { name: "Download release", exact: true }),
  ).toHaveCount(0);
  await page.clock.install();
  await root.getByRole("button", { name: "Sync shows", exact: true }).click();
  await expect(root.locator('[data-admin-ux="upcoming-sync"]')).toBeVisible();
  await finish(page).click();
  await expect(
    root.getByRole("button", { name: "Sync shows", exact: true }),
  ).toBeDisabled();
  await page.clock.fastForward(10010);
  await expect(
    root.getByRole("button", { name: "Sync shows", exact: true }),
  ).toBeEnabled();
  await page.getByRole("radio", { name: "Cargando", exact: true }).click();
  await expect(
    root.getByRole("status", { name: "Loading upcoming items" }),
  ).toBeVisible();
  await finish(page).click();
  await expect(
    root.getByRole("link", { name: "Luz de octubre", exact: true }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Vacío", exact: true }).click();
  await expect(
    root.getByText("Nothing upcoming", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});
test("Upcoming persistent checkpoint preserves published Translations and previous frames", async ({
  page,
}) => {
  await page.goto("/#proximamente-admin");
  await expect(
    page.getByRole("region", {
      name: "Checkpoint 1AO, Upcoming de Admin",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[title="Upcoming real con datos de muestra"]')
      .getByRole("heading", { name: "Upcoming", exact: true }),
  ).toBeVisible();
  await expect(page.locator("footer")).toContainText("1AN publicado");
  await expect(page.locator("footer")).toContainText("1AO publicado");
  await expect(
    page.locator('iframe[src="./admin-translations-demo.html"]'),
  ).toHaveCount(1);
});

test("Upcoming metadata uses JetBrains Mono at400 across cards and popovers", async ({
  page,
}) => {
  const { root, unexpected, errors } = await open(page);
  await page.waitForFunction(() => document.fonts.status === "loaded");
  const check = async (node: Locator) => {
    const style = await node.evaluate((e) => ({
      family: getComputedStyle(e).fontFamily,
      weight: getComputedStyle(e).fontWeight,
    }));
    expect(style.family).toContain("JetBrains");
    expect(style.weight).toBe("400");
  };
  await check(root.getByText("October 2026", { exact: true }));
  for (const text of ["OCT", "20", "TUE"])
    await check(
      root
        .locator('time[datetime="2026-10-20"]')
        .getByText(text, { exact: true }),
    );
  const show = root
    .locator('[role="button"][aria-expanded="false"]')
    .filter({ hasText: "Sala Puerto" });
  for (const text of ["OCT", "24", "SAT"])
    await check(show.getByText(text, { exact: true }));
  await show.press("Enter");
  await check(root.getByText("Sat, Oct 24, 2026", { exact: true }));
  await check(root.getByText("21:00", { exact: true }));
  await root
    .getByRole("button", { name: "Close show details", exact: true })
    .click();
  await root.getByRole("button", { name: "Calendar", exact: true }).click();
  await root
    .getByRole("button", { name: "Costa Norte", exact: true })
    .first()
    .click();
  await check(page.getByText("Tue, Oct 20, 2026", { exact: true }));
  await page.keyboard.press("Escape");
  await root
    .getByRole("button", { name: "Costa Norte", exact: true })
    .nth(2)
    .click();
  await check(page.getByText("Downloading...", { exact: true }));
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

for (const width of [1440, 768, 390])
  test(`Upcoming icon-only view controls beside title ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    const { root, unexpected, errors } = await open(page);
    const title = root.getByRole("heading", { name: "Upcoming", exact: true });
    const list = root.getByRole("button", { name: "List", exact: true });
    const calendar = root.getByRole("button", {
      name: "Calendar",
      exact: true,
    });
    await expect(list).toHaveText("");
    await expect(calendar).toHaveText("");
    await expect(list).toHaveAttribute("aria-pressed", "true");
    const titleBox = await title.boundingBox(),
      listBox = await list.boundingBox(),
      calendarBox = await calendar.boundingBox();
    expect(listBox!.x).toBeGreaterThanOrEqual(titleBox!.x + titleBox!.width);
    expect(calendarBox!.x).toBeGreaterThan(listBox!.x);
    expect(
      Math.abs(
        listBox!.y + listBox!.height / 2 - titleBox!.y - titleBox!.height / 2,
      ),
    ).toBeLessThanOrEqual(1);
    expect(listBox!.width).toBe(44);
    expect(listBox!.height).toBe(44);
    await calendar.press("Enter");
    await expect(calendar).toHaveAttribute("aria-pressed", "true");
    await expect(
      root.getByRole("button", { name: "Previous month", exact: true }),
    ).toBeVisible();
    await list.press("Space");
    await expect(list).toHaveAttribute("aria-pressed", "true");
    await expect(
      root.getByRole("link", { name: "Luz de octubre", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
  });

test("all local input captions use the shared uppercase language", async ({
  page,
}) => {
  const { root } = await open(page);
  for (const field of await root.locator(".crate-form-field").all()) {
    const label = field.locator(":scope > :first-child");
    await expect(label).toHaveCSS("text-transform", "uppercase");
  }
  await gaps(root);
});

for (const width of [1440, 768, 390])
  test(`Incoming release row layout ${width}: avatar, date, badges and Solar actions`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    const { root } = await open(page);
    const row = root.locator('[data-slot="event-row"]').filter({
      has: page.getByRole("link", { name: "Luz de octubre", exact: true }),
    });
    await expect(row).toHaveCount(1);
    await expect(row.locator('[data-slot="event-artwork"]')).toHaveCSS(
      "width",
      "88px",
    );
    await expect(row.locator('[data-slot="event-artwork"]')).toHaveCSS(
      "height",
      "88px",
    );
    await expect(row.locator("time")).toHaveAttribute("datetime", "2026-10-20");
    const title = await row
      .getByRole("link", { name: "Luz de octubre", exact: true })
      .boundingBox();
    const artist = await row
      .getByRole("link", { name: "Costa Norte", exact: true })
      .boundingBox();
    for (const badge of await row.locator(".crate-info-badge").all())
      expect((await badge.boundingBox())!.y).toBeGreaterThanOrEqual(
        artist!.y + artist!.height,
      );
    expect(artist!.y).toBeGreaterThan(title!.y);
    for (const [role, name] of [
      ["link", "Open album"],
      ["button", "Download release"],
      ["button", "Dismiss release"],
    ] as const) {
      const action = row.getByRole(role, { name, exact: true });
      await expect(action).toHaveText("");
      await expect(action.locator("svg")).toHaveCount(1);
      const box = await action.boundingBox();
      expect(box!.height).toBe(44);
      expect(box!.width).toBe(44);
    }
    await expect(
      row.getByRole("link", { name: "Open album", exact: true }),
    ).toHaveAttribute("href", /luz-de-octubre/);
    const before = await row.evaluate(
      (e) => getComputedStyle(e).backgroundColor,
    );
    await row.hover();
    await expect(row).toHaveCSS("background-color", before);
    const show = root
      .locator('[role="button"][aria-expanded="false"]')
      .filter({ hasText: "Sala Puerto" });
    await show.press("Enter");
    await expect(
      root.getByRole("button", { name: "Close show details" }),
    ).toBeVisible();
  });
