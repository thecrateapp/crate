import { expect, test } from "@playwright/test";

test("Admin operations story shows the five live queue lanes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    "/?path=/story/reviews-admin-operations-solid--solid-surfaces",
  );
  const frame = page.frameLocator("#storybook-preview-iframe");
  const queues = frame.getByRole("region", { name: "Worker queue lanes" });
  await expect(queues.getByRole("listitem")).toHaveCount(5);
  const governor = frame.getByRole("region", { name: "Resource governor" });
  await expect(governor.getByRole("meter")).toHaveCount(5);
  await expect(governor).toContainText("ALLOWED · BACKGROUND WORK RUNS");
  await expect(
    queues.getByRole("listitem", { name: "maintenance queue" }),
  ).toContainText("metadata_enrichment");
  await expect(
    queues.getByRole("group", { name: "playback task flow" }),
  ).toContainText("playback_prepare");
  await expect(
    queues.getByRole("group", { name: "heavy task flow" }),
  ).toContainText("audio_analysis");
  const demoChip = queues.locator('[data-queue-task-id="queue-flow-demo"]');
  await expect(demoChip).toHaveAttribute("data-queue-state", "queued");
  await demoChip.evaluate((element) => {
    (window as Window & { queueDemoChip?: Element }).queueDemoChip = element;
  });
  await frame
    .getByRole("button", { name: "Advance sample task from queued" })
    .click();
  await expect(demoChip).toHaveAttribute("data-queue-state", "running");
  await expect(demoChip).toHaveAttribute("style", /left: 36%/);
  expect(
    await demoChip.evaluate(
      (element) =>
        element ===
        (window as Window & { queueDemoChip?: Element }).queueDemoChip,
    ),
  ).toBe(true);
  await frame
    .getByRole("button", { name: "Advance sample task from running" })
    .click();
  await expect(demoChip).toHaveAttribute("data-queue-state", "done");
  await expect(demoChip).toHaveAttribute("style", /left: 86%/);
  expect(errors).toEqual([]);
});
