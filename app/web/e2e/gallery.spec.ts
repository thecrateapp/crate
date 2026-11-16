import { expect, test } from "@playwright/test";

// The Listen and Admin pages show their screenshots in the shared showcase
// (components/showcase/Showcase.astro), which ryoku.cratemusic.app also uses.
for (const path of ["/listen", "/admin"]) {
  test(`${path} steps through its screenshots`, async ({ page }) => {
    await page.goto(path);
    const showcase = page.locator("[data-showcase]");
    await expect(showcase).toHaveCount(1);
    const counter = showcase.locator("[data-counter]");
    await expect(counter).toHaveText(/^01 \/ \d\d$/);
    await showcase.locator("[data-next]").click();
    await expect(counter).toHaveText(/^02 \/ \d\d$/);
  });
}

test("the showcase mounts again after a client-side navigation", async ({
  page,
}) => {
  await page.goto("/listen");
  await page.locator('a[href="/admin"]').first().click();
  await expect(page).toHaveURL(/\/admin$/);
  const showcase = page.locator("[data-showcase]");
  await showcase.locator("[data-next]").click();
  await expect(showcase.locator("[data-counter]")).toHaveText(/^02 \/ \d\d$/);
});
