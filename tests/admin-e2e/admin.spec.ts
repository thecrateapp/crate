import { expect, test } from "./fixtures";

test("opens the command palette as a centered modal over the whole app", async ({
  openAdminPage,
  page,
}) => {
  await openAdminPage("/");
  await page.keyboard.press("ControlOrMeta+k");

  const dialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(dialog).toBeVisible();
  const viewport = page.viewportSize()!;
  const box = (await dialog.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2);
  expect(box.y).toBeGreaterThan(80);
  expect(box.width).toBeGreaterThan(500);

  const overlay = page.locator('[data-slot="dialog-overlay"]');
  const overlayBox = (await overlay.boundingBox())!;
  expect(overlayBox).toMatchObject({
    x: 0,
    y: 0,
    width: viewport.width,
    height: viewport.height,
  });
  await expect(overlay).toHaveCSS("backdrop-filter", /blur/);
});

test("finds catalog actions by name and queues them", async ({
  adminApi,
  openAdminPage,
  page,
}) => {
  await openAdminPage("/");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Type a command or search...").fill("dupl");

  await page.getByRole("option", { name: "Remove Duplicate Tracks" }).click();

  await expect(page.getByText("Remove Duplicate Tracks queued")).toBeVisible();
  expect(adminApi.calls).toContainEqual({
    method: "POST",
    path: "/api/manage/repair-duplicate-tracks",
    body: null,
  });
});

test("sends the catalog body and reports when the backend skips the task", async ({
  adminApi,
  openAdminPage,
  page,
}) => {
  adminApi.respondTo("/api/manage/sync-lyrics", {
    task_id: null,
    reason: "lyrics_provider_unavailable",
  });
  await openAdminPage("/");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByPlaceholder("Type a command or search...").fill("lyrics");

  await page.getByRole("option", { name: "Sync Missing Lyrics" }).click();

  await expect(
    page.getByText(
      "Sync Missing Lyrics not started: lyrics provider unavailable",
    ),
  ).toBeVisible();
  expect(adminApi.calls).toContainEqual({
    method: "POST",
    path: "/api/manage/sync-lyrics",
    body: { limit: 1000 },
  });
});

test("runs a schedule now from Settings with its catalog label", async ({
  adminApi,
  openAdminPage,
  page,
}) => {
  adminApi.respondTo("/api/worker/schedules/repair_duplicate_tracks/run", {
    task_type: "repair_duplicate_tracks",
    task_id: "task-e2e",
    status: "queued",
  });
  await openAdminPage("/settings");
  await page
    .getByRole("button", { name: /Schedules/ })
    .first()
    .click();

  await page
    .getByRole("button", { name: "Run Duplicate Track Cleanup now" })
    .click();

  await expect(page.getByText("Duplicate Track Cleanup queued")).toBeVisible();
  expect(adminApi.calls).toContainEqual({
    method: "POST",
    path: "/api/worker/schedules/repair_duplicate_tracks/run",
    body: null,
  });
});

test("shows catalog labels on the tasks page", async ({
  openAdminPage,
  page,
}) => {
  await openAdminPage("/tasks");

  await expect(page.getByText("Artist Enrichment").first()).toBeVisible();
  await expect(page.getByText("enrich_artists", { exact: true })).toHaveCount(
    0,
  );
});
