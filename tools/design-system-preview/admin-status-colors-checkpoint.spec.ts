import { expect, test } from "@playwright/test";

for (const width of [1440, 768, 390]) {
  test(`Admin status palette stays readable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.url().includes("/api/")) requests.push(request.url());
    });

    await page.goto("/review-admin-status-colors.html");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Status has one visual language.",
      }),
    ).toBeVisible();

    const neutral = page.locator('[data-tone="neutral"]');
    const info = page.locator('[data-tone="info"]');
    const success = page.locator('[data-tone="success"]');
    const warning = page.locator('[data-tone="warning"]');
    const risk = page.locator('[data-tone="danger"]');
    for (const badge of [neutral, info, success, warning, risk])
      await expect(badge).toBeVisible();

    await expect(neutral).toHaveClass(/border-border-quiet/);
    await expect(info).toHaveClass(/text-accent-action/);
    await expect(success).toHaveClass(/text-accent-action-hi/);
    await expect(warning).toHaveClass(/text-state-warning-text/);
    await expect(risk).toHaveClass(/text-state-warning-text/);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
    expect(requests).toEqual([]);
  });
}
