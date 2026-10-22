import { expect, test, type Page } from "@playwright/test";

async function noPageOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

for (const width of [1440, 768, 390]) {
  test(`Settings and Translations review fits ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    const externalRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/") || url.port === "5174")
        externalRequests.push(request.url());
    });
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/review-admin-settings-translations.html");

    const controls = page.locator(
      '[data-admin-review-controls="settings-translations"]',
    );
    const settings = page.getByRole("region", {
      name: "Página real de Settings",
    });
    await expect(
      settings.getByRole("heading", { name: "Settings" }),
    ).toBeVisible();
    await expect(settings.getByRole("tab", { name: "General" })).toBeVisible();
    await settings.getByRole("tab", { name: "Downloads" }).click();
    await expect(
      settings.getByRole("group", { name: "Tidal Access" }),
    ).toBeVisible();
    await settings.getByRole("tab", { name: "Storage" }).click();
    await expect(
      settings.getByRole("group", { name: "Database Footprint" }),
    ).toBeVisible();
    await noPageOverflow(page);

    await controls.getByRole("radio", { name: "Translations" }).click();
    const translations = page.getByRole("region", {
      name: "Página real de Translations",
    });
    await expect(
      translations.getByRole("heading", { name: "Listen Translations" }),
    ).toBeVisible();
    const spanish = translations.getByRole("article", {
      name: "es locale health",
    });
    await expect(spanish.getByRole("group", { name: "1 draft" })).toBeVisible();
    await expect(
      translations.getByRole("article", { name: "fr locale health" }),
    ).toBeVisible();
    await translations
      .getByRole("tab", { name: "Bundles", exact: true })
      .click();
    await translations
      .getByRole("combobox", { name: "Locale", exact: true })
      .click();
    await page.getByRole("option", { name: "fr", exact: true }).click();
    await expect(
      translations.getByRole("button", { name: "Review es", exact: true }),
    ).toHaveCount(0);
    await expect(
      translations.getByRole("button", { name: "Review fr", exact: true }),
    ).toBeVisible();
    await noPageOverflow(page);
    const tabs = translations.getByRole("tab");
    const tops = await tabs.evaluateAll((elements) =>
      elements.map((element) =>
        Math.round(element.getBoundingClientRect().top),
      ),
    );
    expect(new Set(tops).size).toBe(1);
    await noPageOverflow(page);

    expect(errors).toEqual([]);
    expect(externalRequests).toEqual([]);
  });
}

test("Settings sample recovers after an unavailable snapshot", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/review-admin-settings-translations.html");
  const controls = page.locator(
    '[data-admin-review-controls="settings-translations"]',
  );
  await controls.getByRole("radio", { name: "Error" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Settings could not be loaded",
  );
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(
    page.getByRole("heading", { name: "Library", exact: true }),
  ).toBeVisible();
});
