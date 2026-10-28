import { expect, test } from "@playwright/test";

async function noPageOverflow(page: import("@playwright/test").Page) {
  const dimensions = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
}

for (const width of [1440, 768, 390]) {
  test(`Users and Roles review adapts at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    const unexpectedRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/") || url.hostname !== "127.0.0.1")
        unexpectedRequests.push(request.url());
    });
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/review-admin-users-roles.html");

    const pageSwitcher = page.getByRole("radiogroup", {
      name: "Página de revisión",
    });
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Ada Costa" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Inspect" }).first().click();
    const detailDialog = page.getByRole("dialog");
    await expect(detailDialog).toBeVisible();
    const dialogBox = await detailDialog.boundingBox();
    expect(dialogBox?.width).toBeLessThanOrEqual(Math.min(width - 24, 1280));
    await page.getByRole("button", { name: "Close" }).click();
    await noPageOverflow(page);

    await pageSwitcher.getByRole("radio", { name: "Roles" }).click();
    await expect(
      page.getByRole("heading", { name: "Roles & Permissions" }),
    ).toBeVisible();
    await expect(
      page.getByRole("table", { name: "library capabilities by role" }),
    ).toBeVisible();
    await noPageOverflow(page);
    expect(errors).toEqual([]);
    expect(unexpectedRequests).toEqual([]);
  });
}

test("review controls exercise loading, error recovery, empty state and inspection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/review-admin-users-roles.html");
  const controls = page.locator('[data-admin-review-controls="users-roles"]');

  await controls.getByRole("radio", { name: "Carga" }).click();
  await expect(
    page.getByRole("status", { name: "Loading users" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Completar lectura de muestra" })
    .click();
  await expect(page.getByRole("heading", { name: "Ada Costa" })).toBeVisible();

  await controls.getByRole("radio", { name: "Error" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "Ada Costa" })).toBeVisible();

  await page.getByRole("button", { name: "Inspect" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await controls.getByRole("radio", { name: "Vacío" }).click();
  await expect(
    page.getByText("No users match the current search or filter."),
  ).toBeVisible();
});
