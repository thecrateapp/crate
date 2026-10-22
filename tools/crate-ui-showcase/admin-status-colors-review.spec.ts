import { expect, test } from "@playwright/test";

test("Admin status colors story renders the shared semantic badge tones", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    "/?path=/story/reviews-admin-status-colors--semantic-palette",
  );

  const frame = page.frameLocator("#storybook-preview-iframe");
  await expect(
    frame.getByRole("heading", {
      level: 1,
      name: "Status has one visual language.",
    }),
  ).toBeVisible();
  for (const tone of ["neutral", "info", "success", "warning", "danger"])
    await expect(frame.locator(`[data-tone="${tone}"]`)).toBeVisible();
  expect(errors).toEqual([]);
});
