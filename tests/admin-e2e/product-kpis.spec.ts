import { expect, test } from "./fixtures";
import { prepareAdminCapture } from "./screenshots";

const end = new Date("2026-11-02T00:00:00Z");

function day(offset: number) {
  const date = new Date(end);
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function series(
  kpi: string,
  base: number,
  dims: Record<string, string> = {},
  sample: number | null = 6,
) {
  return {
    kpi,
    dims,
    points: Array.from({ length: 60 }, (_, offset) => ({
      day: day(59 - offset),
      value: sample !== null && sample < 3 ? null : base + (offset % 7),
      sample,
      suppressed: sample !== null && sample < 3,
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
    series("users.total", 42),
    series("users.active", 31),
    series("users.daily_listeners", 12),
    series("users.weekly_listeners", 20),
    series("users.monthly_listeners", 28),
    series("users.signups", 1),
    series("users.retention_w1", 0.6),
    series("devices.active_by_platform", 18, { platform: "android" }),
    series("devices.active_by_platform", 9, { platform: "web" }),
    series("listening.plays", 420),
    series("listening.hours", 26),
    series("listening.sessions", 48),
    series("listening.session_minutes_avg", 31),
    series("listening.plays_by_platform", 300, { platform: "android" }),
    series("listening.plays_by_platform", 110, { platform: "web" }),
    series("listening.plays_by_platform", 2, { platform: "ios" }, 1),
    series("listening.plays_by_source", 200, { source: "radio" }),
    series("listening.plays_by_source", 150, { source: "album" }),
    series("library.tracks", 48210),
    series("library.size_gib", 1180),
    series("library.played_share_30d", 0.18),
    series("acquisition.completed", 4, { source: "soulseek" }, null),
    series("acquisition.failed", 1, { source: "soulseek" }, null),
    series("engagement.likes", 22),
    series("federation.active_peers", 3),
    series("streams.requests", 900),
    series("streams.gib", 14),
  ],
};

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 768, height: 1000 },
  { width: 390, height: 900 },
]) {
  test.describe(`Product KPIs ${viewport.width}`, () => {
    test.use({ viewport });

    test("reads the KPI window without overflow and hides small segments", async ({
      adminApi,
      openAdminPage,
      page,
    }, info) => {
      await prepareAdminCapture(page);
      adminApi.respondTo("/api/admin/kpis", kpis);
      const requests: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/api/admin/kpis")) {
          requests.push(new URL(request.url()).search);
        }
      });

      await openAdminPage("/product");

      await expect(
        page.getByRole("heading", { name: "Product", level: 1 }),
      ).toBeVisible();
      const listening = page.getByRole("region", { name: "Listening" });
      await expect(listening.getByText("Plays", { exact: true })).toBeVisible();
      await expect(
        listening.getByText("Hidden, fewer than 3 listeners"),
      ).toBeVisible();
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);

      await page.getByRole("radio", { name: "90d" }).click();
      await expect.poll(() => requests.at(-1)).toBe("?days=90");

      await page.screenshot({
        path: info.outputPath(`product-${viewport.width}.png`),
        fullPage: true,
      });
    });
  });
}
