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
    page.locator('#what-is-crate a[href="https://cratemusic.app"]'),
  ).toHaveCount(1);
});

test("says the desktop app needs a Crate server and points local music at Ryotunes", async ({
  page,
}) => {
  const crate = page.locator("#what-is-crate");
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

test("the bar anchors every section, like cratemusic.app's", async ({
  page,
}) => {
  const bar = page.locator("header.nav .links a");
  await expect(bar).toHaveText([
    "Screenshots",
    "Tour",
    "Crate UI",
    "What is Crate",
    "Install",
    "GitHub",
  ]);
  for (const id of [
    "screenshots",
    "tour",
    "crate-ui",
    "what-is-crate",
    "install",
  ]) {
    await expect(page.locator(`header.nav a[href="#${id}"]`)).toHaveCount(1);
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  await expect(bar.first()).toHaveAttribute("data-hover-scramble", "");
});

test("the footer links Crate, the mod's repository and Ryoku's site", async ({
  page,
}) => {
  const links = page.locator("#footer nav a");
  await expect(links).toHaveText(["Crate", "GitHub", "Ryoku"]);
  await expect(links.nth(0)).toHaveAttribute("href", "https://cratemusic.app");
  await expect(links.nth(1)).toHaveAttribute(
    "href",
    "https://github.com/thecrateapp/crate-for-ryoku",
  );
  await expect(links.nth(2)).toHaveAttribute("href", "https://ryoku.dev");
});
