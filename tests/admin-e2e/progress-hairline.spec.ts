import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, TestInfo } from "@playwright/test";

import { expect, test } from "./fixtures";
import { prepareAdminCapture } from "./screenshots";

async function expectUsableHairline(bar: Locator) {
  await expect(bar).toBeVisible();
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

async function captureTasks(panel: Locator, info: TestInfo, viewport: string) {
  const name = `admin-task-progress-${viewport}.png`;
  if (process.env.CRATE_VISUAL_SMOKE === "1") {
    await panel.screenshot({
      path: info.outputPath(name),
      animations: "disabled",
      caret: "hide",
    });
    return;
  }
  await expect(panel).toHaveScreenshot(name);
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test.describe(`task progress ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("keeps measured progress and an unknown wait distinct without API writes", async ({
      adminApi,
      openAdminPage,
      page,
    }, info) => {
      await prepareAdminCapture(page);
      const snapshot = JSON.parse(
        readFileSync(join(__dirname, "fixtures/tasks-snapshot.json"), "utf8"),
      );
      const baseTask = {
        type: "enrich_artists",
        status: "running",
        pool: "maintenance",
        created_at: "2026-10-10T21:00:00Z",
        started_at: "2026-10-10T21:00:10Z",
        updated_at: "2026-10-10T21:00:50Z",
      };
      snapshot.live.running_tasks = [
        {
          ...baseTask,
          id: "measured-progress",
          progress: { done: 1, total: 4, percent: 25, item: "1/4 artists" },
        },
        {
          ...baseTask,
          id: "unknown-progress",
          progress: { step: "building_snapshot" },
        },
      ];
      snapshot.live.pending_tasks = [];
      snapshot.live.worker_slots.active = 2;
      snapshot.history = [];
      adminApi.respondTo("/api/admin/tasks-snapshot", snapshot);
      if (viewport.name === "mobile") {
        await page.goto("/tasks");
        await expect(
          page.getByRole("button", { name: "Open navigation" }),
        ).toBeVisible();
      } else {
        await openAdminPage("/tasks");
      }
      const panel = page.locator("section").filter({
        has: page.getByRole("heading", {
          name: "Running and queued",
          exact: true,
        }),
      });
      const bars = panel.getByRole("progressbar", {
        name: "Task progress",
        exact: true,
      });
      await expect(bars).toHaveCount(2);
      const measured = bars.nth(0);
      const unknown = bars.nth(1);
      await expect(measured).toHaveAttribute("aria-valuenow", "25");
      await expect(measured).toHaveAttribute("aria-valuemax", "100");
      await expect(measured).not.toHaveAttribute("data-indeterminate");
      await expect(unknown).not.toHaveAttribute("aria-valuenow");
      await expect(unknown).toHaveAttribute("data-indeterminate", "true");
      await expect(panel.getByText("1/4 (25%)", { exact: true })).toBeVisible();
      await expect(
        panel.getByText("Step: building snapshot", { exact: true }),
      ).toBeVisible();
      await expect(
        panel.getByRole("button", { name: "Cancel", exact: true }),
      ).toHaveCount(2);
      for (const bar of [measured, unknown]) await expectUsableHairline(bar);
      await panel.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      await captureTasks(panel, info, viewport.name);
      expect(
        adminApi.calls,
        "Viewing task progress does not mutate the API",
      ).toEqual([]);
    });
  });
}
