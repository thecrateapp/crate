import { expect, test } from "@playwright/test";

test("linked metric captions use accent on hover and keyboard focus", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?id=components-statnumber--linked&viewMode=story",
  );
  const first = page.getByRole("link", { name: "12 Followers" });
  const last = page.getByRole("link", { name: "Following 7" });
  await expect(first).toBeVisible();
  const caption = first.getByText("Followers");
  const readonly = page.getByText("Friends", { exact: true });
  const value = first.getByText("12", { exact: true });
  const gray = await readonly.evaluate((el) => getComputedStyle(el).color);
  const numeral = await value.evaluate((el) => getComputedStyle(el).color);
  const accent = await page
    .getByText("Linked metric destination")
    .evaluate((el) => getComputedStyle(el).color);
  await expect(caption).toHaveCSS("color", gray);
  await first.hover();
  await expect(caption).toHaveCSS("color", accent);
  await expect(value).toHaveCSS("color", numeral);
  await expect(readonly).toHaveCSS("color", gray);

  await readonly.hover();
  await expect(caption).toHaveCSS("color", gray);
  await first.press("Tab");
  await expect(last).toBeFocused();
  await expect(last.getByText("Following")).toHaveCSS("color", accent);
  await expect(readonly).toHaveCSS("color", gray);
  await last.press("Shift+Tab");
  await expect(caption).toHaveCSS("color", accent);
});
