import { test, expect, type Page, type Locator } from "@playwright/test";

async function open(page: Page) {
  await page.clock.setFixedTime(new Date("2026-10-18T12:00:00Z"));
  const errors: string[] = [];
  const unexpected: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.startsWith("/api/") ||
      (!("127.0.0.1" === url.hostname || "localhost" === url.hostname) &&
        url.protocol !== "data:")
    )
      unexpected.push(request.url());
  });
  await page.goto("/admin-upcoming-demo.html");
  const root = page.getByRole("region", {
    name: "Página real de Show Management",
    exact: true,
  });
  await expect(
    root.getByRole("heading", { name: "Show Management", exact: true }),
  ).toBeVisible();
  return { root, errors, unexpected };
}

const finish = (page: Page) =>
  page.getByRole("button", {
    name: "Completar acción o lectura de muestra",
    exact: true,
  });

for (const width of [1440, 768, 390])
  test(`Show Management ${width}: Listen row, setlist coverage and show actions`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    const { root, errors, unexpected } = await open(page);
    await page.waitForFunction(() => document.fonts.status === "loaded");
    const title = root.getByRole("heading", {
      name: "Show Management",
      exact: true,
    });
    expect(
      await title.evaluate((node) => getComputedStyle(node).fontFamily),
    ).toContain("Bricolage Grotesque");
    const rows = root.locator('[data-slot="upcoming-event-row"]');
    await expect(rows).toHaveCount(2);
    const dateSlots = await Promise.all(
      (await rows.all()).map((row) =>
        row
          .locator('[data-slot="upcoming-event-date-slot"]')
          .evaluate((node) => {
            const bounds = node.getBoundingClientRect();
            return { x: bounds.x, width: bounds.width };
          }),
      ),
    );
    expect(dateSlots[0]).toEqual(dateSlots[1]);
    const actionCounts = await Promise.all(
      (await rows.all()).map((row) =>
        row
          .locator(
            '[data-slot="upcoming-event-actions-slot"] button, [data-slot="upcoming-event-actions-slot"] a',
          )
          .count(),
      ),
    );
    expect(actionCounts[0]).not.toBe(actionCounts[1]);
    await expect(
      root.getByText("3 billed artists", { exact: true }),
    ).toBeVisible();
    await expect(root.getByText("1 recent", { exact: true })).toBeVisible();
    await expect(root.getByText("1 outdated", { exact: true })).toBeVisible();
    await expect(root.getByText("1 missing", { exact: true })).toBeVisible();
    const firstRow = root.locator('[data-slot="upcoming-event-row"]').first();
    const firstShow = firstRow.locator('button[aria-expanded="false"]');
    await expect(firstShow).toContainText("Sala Puerto");
    await expect(firstRow.locator("img")).toHaveCount(1);
    await expect(firstRow.locator("img")).toHaveClass(/object-cover/);
    const coverSize = await firstRow.locator("img").evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });
    expect(coverSize).toEqual({ width: 88, height: 88 });
    await expect(
      firstRow.getByRole("link", { name: "Open show listing" }),
    ).toHaveAttribute("href", /^\/admin-upcoming-demo\.html\?destino=/);
    await firstShow.press("Enter");
    await expect(
      root.getByRole("heading", { name: "Probable setlists by artist" }),
    ).toBeVisible();
    await expect(
      root.getByText("Aguas quietas tour", { exact: true }),
    ).toBeVisible();
    await expect(
      root.getByText("Based on 6 shows", { exact: true }),
    ).toBeVisible();
    await expect(root.getByText("Bruma", { exact: true })).toBeVisible();
    await expect(root.getByText("Outdated", { exact: true })).toBeVisible();
    await root
      .getByRole("button", { name: "Close show details", exact: true })
      .click();

    const search = root.getByRole("textbox", { name: "Artist", exact: true });
    await search.fill("not a billed artist");
    await expect(
      root.getByText("No shows match these filters", { exact: true }),
    ).toBeVisible();
    await search.fill("");
    await expect(
      root.getByRole("button", { name: "Calendar", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  });

test("Show Management queues only stale probable setlists and exposes separate show actions", async ({
  page,
}) => {
  const { root, errors, unexpected } = await open(page);
  await root
    .getByRole("button", { name: "Refresh setlists", exact: true })
    .click();
  await expect(finish(page)).toBeEnabled();
  await finish(page).click();
  await expect(
    root.getByText("2 refreshes queued", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});

test("Show Management permissions, loading and empty states reflect their actions", async ({
  page,
}) => {
  const { root, errors, unexpected } = await open(page);
  await page.getByRole("radio", { name: "Adquisición", exact: true }).click();
  await expect(root.getByRole("button", { name: "Add show" })).toHaveCount(0);
  await expect(root.getByRole("button", { name: "Sync shows" })).toHaveCount(0);
  await expect(
    root.getByRole("button", { name: "Refresh setlists" }),
  ).toHaveCount(0);
  await page.getByRole("radio", { name: "Conciertos", exact: true }).click();
  await expect(root.getByRole("button", { name: "Add show" })).toBeVisible();
  await expect(root.getByRole("button", { name: "Sync shows" })).toBeVisible();
  await expect(
    root.getByRole("button", { name: "Refresh setlists" }),
  ).toHaveCount(0);
  await page.getByRole("radio", { name: "Cargando", exact: true }).click();
  await expect(
    root.getByRole("status", { name: "Loading shows" }),
  ).toBeVisible();
  await finish(page).click();
  await expect(root.getByRole("status", { name: "Loading shows" })).toHaveCount(
    0,
  );
  await page.getByRole("radio", { name: "Vacío", exact: true }).click();
  await expect(
    root.getByText("No upcoming shows", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});

test("Show Management checkpoint keeps previous published surfaces", async ({
  page,
}) => {
  await page.goto("/#proximamente-admin");
  await expect(page.locator("#proximamente-admin")).toBeVisible({
    timeout: 15000,
  });
  const frame = page.frameLocator(
    'iframe[title="Show Management real con datos de muestra"]',
  );
  await expect(
    frame.getByRole("heading", { name: "Show Management", exact: true }),
  ).toBeVisible();
  await expect(page.locator("footer")).toContainText("1AN publicado");
  await expect(page.locator("footer")).toContainText("1AO publicado");
  await expect(
    page.locator('iframe[src="./admin-translations-demo.html"]'),
  ).toHaveCount(1);
});

test("Show date and setlist metadata use the mono label face", async ({
  page,
}) => {
  const { root, unexpected, errors } = await open(page);
  await page.waitForFunction(() => document.fonts.status === "loaded");
  const check = async (node: Locator, family = "JetBrains") => {
    const style = await node.evaluate((element) => ({
      family: getComputedStyle(element).fontFamily,
      weight: getComputedStyle(element).fontWeight,
    }));
    expect(style.family).toContain(family);
    if (family === "JetBrains") expect(style.weight).toBe("400");
  };
  await check(root.getByText("October 2026", { exact: true }));
  const showRow = root.locator('[data-slot="upcoming-event-row"]').first();
  const show = showRow.locator('button[aria-expanded="false"]');
  await check(
    showRow.locator('time[datetime="2026-10-24"] .crate-mono-label').first(),
  );
  await check(
    showRow.locator('time[datetime="2026-10-24"] > span.font-display'),
    "Bricolage Grotesque",
  );
  await show.press("Enter");
  await check(
    root
      .locator('[data-slot="show-management-ticket"] .crate-mono-label')
      .filter({ hasText: /Updated/ })
      .first(),
  );
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
});
