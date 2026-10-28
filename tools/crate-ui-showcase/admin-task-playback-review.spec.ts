import { expect, test } from "@playwright/test";

test("the Task desk and Playback Delivery review story renders and switches pages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    "/?path=/story/reviews-admin-tasks-and-playback-delivery--task-desk-and-playback",
  );

  const canvas = page
    .frameLocator("#storybook-preview-iframe")
    .locator("#storybook-root");
  await expect(
    canvas.getByRole("heading", { level: 1, name: "Tasks" }),
  ).toBeVisible();
  await expect(
    canvas.getByRole("heading", { name: "Worker runtime" }),
  ).toBeVisible();
  await expect(
    canvas.getByRole("heading", { name: "Task desk" }),
  ).toBeVisible();
  await expect(
    canvas.getByRole("heading", { name: "Worker runtime" }),
  ).toHaveClass(/text-accent-action-hi/);
  await expect(canvas.getByRole("heading", { name: "Task desk" })).toHaveClass(
    /text-accent-action-hi/,
  );
  await expect(
    canvas.getByRole("group", { name: "DB-heavy gate" }),
  ).toContainText("No DB-heavy serialization pressure");

  const refresh = canvas.getByRole("button", { name: "Refresh" });
  await expect(refresh).toHaveAttribute("data-size", "icon-lg");
  await expect(refresh).not.toContainText("Refresh");
  const increaseConcurrency = canvas.getByRole("button", {
    name: "Increase worker concurrency",
  });
  const workerLogs = canvas.getByRole("link", { name: "Worker logs" });
  await expect(workerLogs).toHaveAttribute("data-size", "icon-lg");
  await expect(workerLogs).not.toContainText("Worker logs");
  const cancelAll = canvas.getByRole("button", { name: "Cancel all tasks" });
  await expect(cancelAll).toHaveAttribute("data-size", "icon-lg");
  await expect(cancelAll).not.toContainText("Cancel all");
  const restartWorker = canvas.getByRole("button", {
    name: "Restart crate-worker",
  });
  await expect(restartWorker).toHaveAttribute("data-size", "icon-lg");
  await expect(restartWorker).not.toContainText("Restart");
  await restartWorker.hover();
  await expect(
    page.frameLocator("#storybook-preview-iframe").getByRole("tooltip", {
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

  const search = canvas.getByRole("textbox", { name: "Search tasks" });
  const family = canvas.getByRole("combobox", { name: "Task family" });
  const taskType = canvas.getByRole("combobox", { name: "All task types" });
  const [searchBounds, familyBounds, taskTypeBounds] = await Promise.all([
    search.evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }),
    family.evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }),
    taskType.evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }),
  ]);
  expect(searchBounds.y).toBe(familyBounds.y);
  expect(familyBounds.y).toBe(taskTypeBounds.y);
  expect(searchBounds.height).toBe(familyBounds.height);
  expect(familyBounds.height).toBe(taskTypeBounds.height);
  expect(searchBounds.width).toBeGreaterThan(familyBounds.width);
  await family.click();
  await page
    .frameLocator("#storybook-preview-iframe")
    .getByRole("option", { name: "Analysis" })
    .click();
  await expect(family).toContainText("Analysis");

  await canvas
    .getByRole("tablist", { name: "Admin task review pages" })
    .getByRole("tab", { name: "Playback Delivery" })
    .click();
  await expect(
    canvas.getByRole("heading", { level: 1, name: "Playback Delivery" }),
  ).toBeVisible();
  await expect(canvas.getByText("The Universal")).toBeVisible();
});
