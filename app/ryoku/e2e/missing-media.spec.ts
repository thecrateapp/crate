import { expect, test } from "@playwright/test";

test("missing clips fall back to a poster or a placeholder, never a broken player", async ({
  page,
}) => {
  await page.route("**/media/**", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.goto("/");
  const slots = page.locator("[data-clip]");
  await expect(slots.first()).toBeVisible();
  const count = await slots.count();
  expect(count).toBe(9);
  for (let i = 0; i < count; i++) {
    const slot = slots.nth(i);
    await expect(slot).toHaveAttribute("data-state", "placeholder");
    await expect(slot.locator("video")).toHaveCount(0);
  }
});

test("a clip whose video is missing shows its poster", async ({
  page,
  request,
}) => {
  const still = await (await request.get("/icons/icon-192.png")).body();
  await page.route("**/media/**", (route) =>
    route.request().url().endsWith(".jpg")
      ? route.fulfill({ status: 200, contentType: "image/png", body: still })
      : route.fulfill({ status: 404, body: "" }),
  );
  await page.goto("/");
  const slot = page.locator('[data-clip="dock"]');
  await expect(slot).toHaveAttribute("data-state", "poster");
  await expect(slot.locator("img")).toHaveAttribute("alt", "The shima dock");
  await expect(slot.locator("video")).toHaveCount(0);
});
