import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("states the positioning line", async ({ page }) => {
  await expect(
    page.getByText(
      "An opinionated mod of Ryoku based on Crate's visual design",
    ),
  ).toBeVisible();
});

test("the primary action leads to the install section", async ({ page }) => {
  const install = page
    .getByRole("link", { name: "Install Crate for Ryoku" })
    .first();
  await expect(install).toHaveAttribute("href", "#install");
});

test("links to cratemusic.app", async ({ page }) => {
  await expect(
    page.locator('#crate a[href="https://cratemusic.app"]'),
  ).toHaveCount(1);
});

test("says the desktop app needs a Crate server and points local music at Ryotunes", async ({
  page,
}) => {
  const crate = page.locator("#crate");
  await expect(crate).toContainText("needs a Crate server");
  await expect(crate).toContainText("Ryotunes");
});

test("the install section shows the pacman repository and the setup command", async ({
  page,
}) => {
  const install = page.locator("#install");
  await expect(install).toContainText("[crate-for-ryoku]");
  await expect(install).toContainText(
    "pacman -Syu crate-for-ryoku crate-desktop-bin",
  );
  await expect(install).toContainText("crate-for-ryoku install");
  await expect(install).toContainText("Ryostore");
});

test("every surface has a clip slot", async ({ page }) => {
  for (const id of [
    "qsbar",
    "controls",
    "launcher",
    "gamebar",
    "kit",
    "pickers",
    "dock",
    "notifications",
  ]) {
    await expect(page.locator(`#surfaces [data-clip="${id}"]`)).toHaveCount(1);
  }
});
