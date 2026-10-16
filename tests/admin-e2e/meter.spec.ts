import type { Locator } from "@playwright/test";

import { expect, test } from "./fixtures";
import { prepareAdminCapture } from "./screenshots";

async function expectUsableMeter(meter: Locator) {
  await expect(meter).toBeVisible();
  await expect(meter).toHaveAttribute("aria-valuenow", "0");
  await expect(meter).toHaveAttribute("aria-valuemax", "1");
  await expect(meter).toHaveAttribute("aria-valuetext", "0/1");
  const geometry = await meter.evaluate((element) => {
    const track = element.querySelector(".crate-meter-track");
    const parent = element.parentElement;
    if (!track || !parent) throw new Error("Missing meter track or container");
    const bounds = element.getBoundingClientRect();
    const container = parent.getBoundingClientRect();
    return {
      trackWidth: track.getBoundingClientRect().width,
      leftOverflow: container.left - bounds.left,
      rightOverflow: bounds.right - container.right,
    };
  });
  expect(
    geometry.trackWidth,
    "The meter retains a usable track",
  ).toBeGreaterThanOrEqual(80);
  expect(geometry.leftOverflow).toBeLessThanOrEqual(0.5);
  expect(geometry.rightOverflow).toBeLessThanOrEqual(0.5);
  await expect(
    meter
      .locator("..")
      .getByText("Active playback worker capacity", { exact: true }),
  ).toBeVisible();
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test.describe(`transcoding meter ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("keeps the real worker-capacity meter usable within its container", async ({
      adminApi,
      openAdminPage,
      page,
    }) => {
      await prepareAdminCapture(page);
      if (viewport.name === "mobile") {
        await page.goto("/system");
        await expect(
          page.getByRole("button", { name: "Open navigation" }),
        ).toBeVisible();
      } else {
        await openAdminPage("/system");
      }
      const meter = page.getByRole("meter", {
        name: "Transcode Slots",
        exact: true,
      });
      await meter.scrollIntoViewIfNeeded();
      await expectUsableMeter(meter);
      expect(
        adminApi.calls,
        "Reading worker capacity does not mutate the API",
      ).toEqual([]);
    });
  });
}
