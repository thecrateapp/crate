import type { Locator, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";

async function captureUpload(section: Locator, info: TestInfo) {
  const name = "upload-progress-default-dark.png";
  if (process.env.CRATE_VISUAL_SMOKE === "1") {
    await section.screenshot({
      path: info.outputPath(name),
      animations: "disabled",
      caret: "hide",
    });
    return;
  }
  await expect(section).toHaveScreenshot(name);
}

test("shows pending direct uploads without inventing byte progress and queues the real selection", async ({
  openListenPage,
  page,
}, info) => {
  if (info.project.name === "mobile") {
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  let releaseResponse!: () => void;
  const responseReleased = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let responseFinished!: () => void;
  const finished = new Promise<void>((resolve) => {
    responseFinished = resolve;
  });
  const uploads: { method: string; body: string }[] = [];
  await openListenPage("/upload");
  await page.route("**/api/acquisition/upload", async (route) => {
    uploads.push({
      method: route.request().method(),
      body: route.request().postDataBuffer()?.toString("utf8") ?? "",
    });
    try {
      await responseReleased;
      await route.fulfill({
        json: {
          task_id: "visual-upload",
          upload_id: "upload-progress",
          file_count: 2,
          total_bytes: 3072,
        },
      });
    } finally {
      responseFinished();
    }
  });
  const input = page.locator('input[type="file"]');
  const clear = page.getByRole("button", { name: "Clear", exact: true });
  const submit = page.getByRole("button", {
    name: "Import to library",
    exact: true,
  });
  const names = ["High Vis - Mob DLA.flac", "High Vis - Trauma Bonds.flac"];
  await input.setInputFiles(
    names.map((name, index) => ({
      name,
      mimeType: "audio/flac",
      buffer: Buffer.alloc((index + 1) * 1024),
    })),
  );
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(clear).toBeEnabled();
  await expect(submit).toBeEnabled();
  try {
    await submit.click();
    await expect.poll(() => uploads.length).toBe(1);
    await expect(input).toBeDisabled();
    await expect(clear).toBeDisabled();
    await expect(submit).toBeDisabled();
    for (const name of names) {
      const bar = page.getByRole("progressbar", { name, exact: true });
      await expect(bar).toBeVisible();
      await expect(bar).not.toHaveAttribute("aria-valuenow");
      await expect(bar).toHaveAttribute("data-indeterminate", "true");
      const geometry = await bar.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const parent = element.parentElement!.getBoundingClientRect();
        const fill = element.querySelector(".crate-progress-hairline-fill")!;
        return {
          width: bounds.width,
          height: bounds.height,
          leftOverflow: parent.left - bounds.left,
          rightOverflow: bounds.right - parent.right,
          viewportOverflow: bounds.right - window.innerWidth,
          animation: getComputedStyle(fill).animationName,
        };
      });
      expect(geometry.width).toBeGreaterThanOrEqual(80);
      expect([1, 2]).toContain(geometry.height);
      expect(geometry.leftOverflow).toBeLessThanOrEqual(0.5);
      expect(geometry.rightOverflow).toBeLessThanOrEqual(0.5);
      expect(geometry.viewportOverflow).toBeLessThanOrEqual(0.5);
      expect(geometry.animation).toBe("none");
    }
    const section = page
      .getByRole("progressbar", { name: names[0], exact: true })
      .locator("../../..");
    await section.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await captureUpload(section, info);
  } finally {
    releaseResponse();
    if (uploads.length > 0) await finished;
  }
  await expect(page.getByText("Upload queued", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Task `visual-upload` is processing 2 files.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(clear).toHaveCount(0);
  await expect(input).toBeEnabled();
  await expect(submit).toBeDisabled();
  expect(uploads).toHaveLength(1);
  expect(uploads[0].method).toBe("POST");
  for (const name of names)
    expect(uploads[0].body).toContain(`filename="${name}"`);
});
