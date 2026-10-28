import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`A2 System Health and Stack use solid operational cards at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/admin-system-health-demo.html");
    const health = page.getByRole("region", { name: "Página real de Admin" });
    await expect(
      health.getByRole("heading", { level: 1, name: "System Health" }),
    ).toBeVisible();
    const healthHeader = health.locator(
      '[data-slot="admin-page-header-container"]',
    );
    await expect(healthHeader).toBeVisible();
    await expect(healthHeader).toHaveClass(/min-w-0/);
    await expect(healthHeader).not.toHaveClass(/border|bg-|shadow|p-5/);
    for (const label of ["Music Volume", "API Latency"]) {
      const card = health
        .getByText(label)
        .locator("xpath=ancestor::*[contains(@class, 'rounded-md')][1]");
      await expect(card).toHaveClass(/border-border-quiet/);
      await expect(card).toHaveClass(/bg-raised-surface/);
      await expect(card).toHaveClass(/shadow-none/);
      await expect(card).not.toHaveClass(/backdrop-blur|bg-black\//);
    }

    await page.goto("/admin-operations-demo.html?page=stack");
    const stack = page.getByRole("region", { name: "Página real de Admin" });
    const stackHeader = stack.locator(
      '[data-slot="admin-page-header-container"]',
    );
    await expect(stackHeader).toBeVisible();
    await expect(stackHeader).not.toHaveClass(/border|bg-|shadow|p-5/);
    const worker = stack.getByRole("article", { name: "Service worker" });
    await expect(worker).toBeVisible();
    await expect(worker).toHaveClass(/border-border-quiet/);
    await expect(worker).toHaveClass(/bg-raised-surface/);
    await expect(worker).toHaveClass(/shadow-none/);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}
