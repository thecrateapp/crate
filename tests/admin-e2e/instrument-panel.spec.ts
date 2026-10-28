import { expect, test } from "./fixtures";
import { prepareAdminCapture } from "./screenshots";

test("preserves the page spacing after the Resources instrument", async ({
  openAdminPage,
  page,
}) => {
  await prepareAdminCapture(page);
  await openAdminPage("/system");
  const resources = page.getByRole("figure", {
    name: "Music volume uses 280 of 1000 GB.",
  });
  const nextPanel = page
    .getByRole("heading", { name: "Metric Streams", exact: true })
    .locator("xpath=ancestor::section[1]");
  await expect(resources).toBeVisible();
  await expect(nextPanel).toBeVisible();
  await expect
    .poll(() =>
      resources.evaluate((element) => {
        const next = element.nextElementSibling;
        if (!next) throw new Error("Missing panel after Resources");
        return (
          next.getBoundingClientRect().top -
          element.getBoundingClientRect().bottom
        );
      }),
    )
    .toBeGreaterThanOrEqual(24);
});
