import { expect, test } from "@playwright/test";
test("Select keeps its width when a longer option is selected", async ({
  page,
}) => {
  await page.goto(
    "/iframe.html?id=components-select--stable-width&viewMode=story",
  );
  const trigger = page.getByRole("combobox", { name: "Stable select" });
  await expect(trigger).toBeVisible();
  const before = (await trigger.boundingBox())!.width;
  await trigger.click();
  await page
    .getByRole("option", {
      name: "Recently added to the collection",
      exact: true,
    })
    .click();
  expect((await trigger.boundingBox())!.width).toBeCloseTo(before, 1);
  expect(before).toBe(192);
});
