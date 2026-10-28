import { expect, test, type Page } from "@playwright/test";

async function noPageOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

for (const width of [1440, 768, 390]) {
  test(`Federation review remains usable at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    const unexpectedRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/") || url.port === "5174")
        unexpectedRequests.push(request.url());
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/review-admin-federation.html");

    await expect(
      page.getByRole("heading", { name: "Federation", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Crate Review Node")).toBeVisible();
    const tabs = page.getByRole("tablist", { name: "Federation operations" });
    await expect(tabs.getByRole("tab")).toHaveCount(7);
    await tabs.getByRole("tab", { name: "Peers" }).click();
    await expect(page.getByText("Pairing", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Pair Lisbon Independent Archive" }),
    ).toBeVisible();
    const inputWidths = await page
      .locator('input[aria-label="Probe URL"], input[aria-label="Pairing URL"]')
      .evaluateAll((inputs) =>
        inputs.map((input) => input.getBoundingClientRect().width),
      );
    expect(inputWidths).toHaveLength(2);
    const [probeWidth, pairingWidth] = inputWidths;
    expect(probeWidth).toBeDefined();
    expect(pairingWidth).toBeDefined();
    expect(probeWidth).toBeCloseTo(pairingWidth ?? 0, 1);
    await noPageOverflow(page);

    await page
      .locator('[data-admin-review-controls="federation"]')
      .getByRole("radio", { name: "Read only" })
      .click();
    await expect(
      page.getByRole("button", { name: "Pair Lisbon Independent Archive" }),
    ).toHaveCount(0);
    await noPageOverflow(page);

    expect(errors).toEqual([]);
    expect(unexpectedRequests).toEqual([]);
  });
}

test("Federation tabs expose empty, loading and recoverable error states", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/review-admin-federation.html");
  const controls = page.locator('[data-admin-review-controls="federation"]');
  await controls.getByRole("radio", { name: "Empty" }).click();
  await expect(page.getByText("No active peer usage.")).toBeVisible();
  await page.getByRole("tab", { name: "Streams" }).click();
  await expect(page.getByText("No active stream tickets.")).toBeVisible();
  await page.getByRole("tab", { name: "Imports" }).click();
  await expect(page.getByText("No remote import requests.")).toBeVisible();
  await controls.getByRole("radio", { name: "Loading" }).click();
  await expect(page.getByText("Loading federation data…")).toBeVisible();
  await controls.getByRole("radio", { name: "Error" }).click();
  await expect(page.getByText("Federation data is unavailable.")).toBeVisible();
  await controls.getByRole("radio", { name: "Data" }).click();
  await page.getByRole("tab", { name: "Imports" }).click();
  await expect(page.getByText("Soft Landing")).toBeVisible();
});
