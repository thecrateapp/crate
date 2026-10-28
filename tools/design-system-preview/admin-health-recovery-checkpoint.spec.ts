import { expect, test } from "@playwright/test";

for (const width of [1440, 768, 390]) {
  test(`Library Health recovery scene stays usable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/review-admin-health-recovery.html");

    await expect(
      page.getByRole("heading", { level: 1, name: "Library Health" }),
    ).toBeVisible();
    await expect(page.getByText("Snapshot stale").first()).toBeVisible();
    await expect(page.getByText("Reconnecting").first()).toBeVisible();
    await expect(page.getByText("Live updates")).toBeVisible();
    await expect(
      page.getByText("Snapshot current", { exact: true }),
    ).toBeVisible();
    const notice = page.getByRole("alert");
    await expect(notice).toContainText(
      "Could not refresh library health. Showing the last successful snapshot.",
    );
    await notice.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("status")).toContainText("Snapshot refreshed");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("the recovery scene has no browser errors or API calls", async ({
  page,
}) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/api/")) requests.push(request.url());
  });
  await page.goto("/review-admin-health-recovery.html");
  await expect(
    page.getByRole("heading", { level: 1, name: "Library Health" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});
