import type { Page } from "@playwright/test";

export async function prepareAdminCapture(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(new Date("2026-10-10T21:01:00Z"));
}
