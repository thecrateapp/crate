import type { Locator, Page, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

async function expectEmptyMirror(section: Locator) {
  const count = section.getByRole("group", { name: "Tracks", exact: true });
  await expect(count).toHaveAccessibleDescription("0/0");
  await expect(count).not.toHaveAttribute("aria-valuenow");
  await expect(
    section.getByText("Mirrored on this device", { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByText("Approximate offline footprint", { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: "Sync offline copy now", exact: true }),
  ).toBeDisabled();
  await expect(
    section.getByRole("button", { name: "Remove offline copies", exact: true }),
  ).toBeDisabled();
}

async function captureOfflineSection(
  page: Page,
  section: Locator,
  info: TestInfo,
) {
  await page.evaluate(() => document.fonts.ready);
  const name = "offline-meters-default-dark.png";
  if (process.env.CRATE_VISUAL_SMOKE === "1") {
    const path = info.outputPath(name);
    await section.screenshot({ path, animations: "disabled", caret: "hide" });
    await info.attach("Offline meter advisory capture", {
      path,
      contentType: "image/png",
    });
    return;
  }
  await expect(section).toHaveScreenshot(name);
}

test("renders the real empty offline mirror with a deterministic browser quota", async ({
  openListenPage,
  page,
}, info) => {
  const quota = 1024 ** 3;
  await page.addInitScript((quota) => {
    Object.defineProperty(navigator.storage, "estimate", {
      configurable: true,
      value: async () => ({ quota, usage: 512 * 1024 * 1024 }),
    });
  }, quota);
  await openListenPage("/settings");
  const section = page.getByRole("region", {
    name: "Offline mirror",
    exact: true,
  });
  await section.scrollIntoViewIfNeeded();
  await expectEmptyMirror(section);

  const storage = section.getByRole("meter", { name: "Storage", exact: true });
  await expect(storage).toHaveAttribute("aria-valuenow", "0");
  await expect(storage).toHaveAttribute("aria-valuemax", String(quota));
  await expect(storage).toHaveAttribute("aria-valuetext", "0 B / 1.0 GB");
  await expect(section.getByRole("meter")).toHaveCount(1);
  await expect(
    section.getByRole("meter", { name: "Tracks", exact: true }),
  ).toHaveCount(0);
  for (const reading of [
    storage,
    section.getByRole("group", { name: "Tracks", exact: true }),
  ]) {
    expect(
      await reading
        .locator(".crate-meter-track")
        .evaluate((element) => element.getBoundingClientRect().width),
    ).toBeGreaterThanOrEqual(80);
  }
  await captureOfflineSection(page, section, info);
});

for (const availability of ["absent", "rejected"] as const) {
  test(`keeps the real offline count when storage estimation is ${availability}`, async ({
    openListenPage,
    page,
  }) => {
    await page.addInitScript((availability) => {
      Object.defineProperty(navigator.storage, "estimate", {
        configurable: true,
        value:
          availability === "absent"
            ? undefined
            : async () => {
                throw new Error("Storage estimation unavailable");
              },
      });
    }, availability);
    await openListenPage("/settings");
    const section = page.getByRole("region", {
      name: "Offline mirror",
      exact: true,
    });
    await section.scrollIntoViewIfNeeded();
    await expectEmptyMirror(section);
    await expect(section.getByRole("meter")).toHaveCount(0);
    await expect(section.getByText("0 B", { exact: true })).toBeVisible();
  });
}
