import { join } from "node:path";

import { expect, test } from "../admin-e2e/fixtures";
import { prepareAdminCapture } from "../admin-e2e/screenshots";

const OUT = process.env.SITE_CAPTURE_OUT ?? "test-results/site-capture";
const END = new Date("2026-11-02T00:00:00Z");

function day(offset: number) {
  const date = new Date(END);
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function series(
  kpi: string,
  base: number,
  dims: Record<string, string> = {},
  sample = 6,
) {
  return {
    kpi,
    dims,
    points: Array.from({ length: 60 }, (_, offset) => ({
      day: day(59 - offset),
      value: sample < 3 ? null : base + (offset % 7),
      sample,
      suppressed: sample < 3,
    })),
  };
}

const kpis = {
  window_days: 30,
  current_start: day(29),
  previous_start: day(59),
  end: day(0),
  computed_at: "2026-11-02T14:00:00Z",
  minimum_sample: 3,
  series: [
    series("listening.plays", 420),
    series("listening.plays_by_platform", 300, { platform: "android" }),
    series("listening.plays_by_platform", 110, { platform: "web" }),
    series("listening.plays_by_platform", 2, { platform: "ios" }, 1),
  ],
};

test.use({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 3 });

test("Product plays by platform", async ({ page, adminApi, openAdminPage }) => {
  await prepareAdminCapture(page);
  adminApi.respondTo("/api/admin/kpis", kpis);
  await openAdminPage("/product");
  const breakdown = page.getByRole("region", { name: "Plays by platform" });
  await expect(
    breakdown.getByText("Hidden, fewer than 3 listeners"),
  ).toBeVisible();
  await breakdown.screenshot({
    path: join(OUT, "product-plays-by-platform.png"),
  });
});
