import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test.describe(`Admin task review ${width}`, () => {
    test.use({
      viewport: { width, height: 1100 },
      isMobile: width === 390,
      hasTouch: width === 390,
    });

    test("reviews the consolidated task desk and dedicated playback page", async ({
      page,
    }, info) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/review-admin-tasks.html");

      const pageTabs = page.getByRole("tablist", {
        name: "Admin task review pages",
      });
      await expect(
        pageTabs.getByRole("tab", { name: "Tasks" }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(
        page.getByRole("heading", { level: 1, name: "Tasks" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Worker runtime" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Task desk" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Worker runtime" }),
      ).toHaveClass(/text-accent-action-hi/);
      await expect(
        page.getByRole("heading", { name: "Task desk" }),
      ).toHaveClass(/text-accent-action-hi/);
      const refresh = page.getByRole("button", { name: "Refresh" });
      await expect(refresh).toHaveAttribute("data-size", "icon-lg");
      await expect(refresh).not.toContainText("Refresh");
      const increaseConcurrency = page.getByRole("button", {
        name: "Increase worker concurrency",
      });
      const workerLogs = page.getByRole("link", { name: "Worker logs" });
      await expect(workerLogs).toHaveAttribute("data-size", "icon-lg");
      await expect(workerLogs).not.toContainText("Worker logs");
      const cancelAll = page.getByRole("button", {
        name: "Cancel all tasks",
      });
      await expect(cancelAll).toHaveAttribute("data-size", "icon-lg");
      await expect(cancelAll).not.toContainText("Cancel all");
      const restartWorker = page.getByRole("button", {
        name: "Restart crate-worker",
      });
      await expect(restartWorker).toHaveAttribute("data-size", "icon-lg");
      await expect(restartWorker).not.toContainText("Restart");
      await restartWorker.hover();
      await expect(
        page.getByRole("tooltip", {
          name: "Restarts crate-worker: default and fast queues plus its service loop.",
        }),
      ).toBeVisible();
      expect(
        await increaseConcurrency.evaluate(
          (button) => button.parentElement?.getBoundingClientRect().height,
        ),
      ).toBe(
        await workerLogs.evaluate(
          (button) => button.getBoundingClientRect().height,
        ),
      );
      const governor = page.getByRole("region", { name: "Resource governor" });
      const gate = page.getByRole("group", { name: "DB-heavy gate" });
      await expect(governor).toBeVisible();
      await expect(gate).toHaveClass(/border-t/);
      await expect(gate).toContainText("No DB-heavy serialization pressure");
      expect(
        await page.evaluate(() => {
          const governor = document.querySelector(
            '[aria-label="Resource governor"]',
          );
          const gate = document.querySelector('[aria-label="DB-heavy gate"]');
          return (
            governor?.parentElement === gate?.parentElement &&
            gate?.parentElement?.classList.contains("gap-10") &&
            getComputedStyle(gate.parentElement).rowGap === "40px"
          );
        }),
      ).toBe(true);
      await expect(page.getByText("Success rate", { exact: true })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("heading", { name: "Playback delivery" }),
      ).toHaveCount(0);

      const deskTabs = page.getByRole("tablist", { name: "Task views" });
      for (const label of ["Active & queued", "Needs attention", "History"]) {
        await expect(deskTabs.getByRole("tab", { name: label })).toBeVisible();
      }
      const search = page.getByRole("textbox", { name: "Search tasks" });
      const family = page.getByRole("combobox", { name: "Task family" });
      const taskType = page.getByRole("combobox", { name: "All task types" });
      await expect(search).toBeVisible();
      await expect(family).toContainText("All families");
      await expect(taskType).toBeVisible();
      const maintenanceLane = page.getByTestId("queue-lane-maintenance");
      const total =
        width <= 760
          ? maintenanceLane.getByTestId("queue-total-count-mobile")
          : maintenanceLane.getByTestId("queue-total-count");
      const [totalCenter, trackCenter] = await Promise.all(
        [
          total,
          maintenanceLane.getByRole("group", {
            name: "maintenance task flow",
          }),
        ].map((element) =>
          element.evaluate((node) => {
            const bounds = node.getBoundingClientRect();
            return bounds.top + bounds.height / 2;
          }),
        ),
      );
      // On desktop the large numeral needs a 2px optical correction: its
      // visible glyph otherwise reads slightly above the lane despite centered boxes.
      const expectedOpticalOffset = width <= 760 ? 0 : 2;
      expect(
        Math.abs(totalCenter - trackCenter - expectedOpticalOffset),
      ).toBeLessThanOrEqual(1);

      if (width >= 1200) {
        const filterBounds = await Promise.all(
          [search, family, taskType].map((field) =>
            field.evaluate((element) => {
              const { x, y, width, height } = element.getBoundingClientRect();
              return { x, y, width, height };
            }),
          ),
        );
        expect(filterBounds[0].y).toBe(filterBounds[1].y);
        expect(filterBounds[1].y).toBe(filterBounds[2].y);
        expect(filterBounds[0].height).toBe(filterBounds[1].height);
        expect(filterBounds[1].height).toBe(filterBounds[2].height);
        expect(filterBounds[0].width).toBeGreaterThan(filterBounds[1].width);
      }
      await family.click();
      await page.getByRole("option", { name: "Analysis" }).click();
      await expect(family).toContainText("Analysis");
      await family.click();
      await page.getByRole("option", { name: "All families" }).click();

      await deskTabs.getByRole("tab", { name: "Needs attention" }).click();
      await expect(page.getByText("Album artwork lookup")).toBeVisible();

      await pageTabs.getByRole("tab", { name: "Playback Delivery" }).click();
      await expect(
        page.getByRole("heading", { level: 1, name: "Playback Delivery" }),
      ).toBeVisible();
      await expect(page.getByText("The Universal")).toBeVisible();
      await expect(
        page.getByRole("meter", { name: "Transcode slots" }),
      ).toHaveAttribute("aria-valuenow", "3");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]);

      await info.attach("admin-task-review", {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });
  });
}
