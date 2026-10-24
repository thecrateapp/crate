import { expect, test } from "./fixtures";
import dashboard from "./fixtures/metrics-dashboard.json";

for (const width of [1440, 390]) {
  test.describe(`Metric instruments ${width}`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 768 });
    test("inspects chronological counter samples and preserves sparse gaps", async ({
      page,
      openAdminPage,
      adminApi,
    }) => {
      const sample = (timestamp: string, count: number) => ({
        timestamp,
        count,
        avg: 1,
        max: 1,
        min: 1,
        sum: count,
      });
      adminApi.respondTo("/api/admin/agent-plans/summary", {
        awaiting_approval: 0,
      });
      adminApi.respondTo("/api/admin/metrics/dashboard", {
        ...dashboard,
        timeseries: {
          ...dashboard.timeseries,
          "api.requests": [
            sample("2026-10-24T12:00:00Z", 0),
            sample("2026-10-24T12:01:00Z", 1),
            sample("2026-10-24T12:20:00Z", 24),
          ],
        },
      });
      await openAdminPage("/system");
      const chart = page.getByRole("region", {
        name: "Request Volume",
        exact: true,
      });
      await chart.scrollIntoViewIfNeeded();
      await expect(
        chart.getByRole("heading", { name: "Request Volume", exact: true }),
      ).toHaveCSS("font-family", /JetBrains Mono/);
      expect(
        await chart.evaluate((node) => getComputedStyle(node).backgroundColor),
      ).toBe("rgba(0, 0, 0, 0)");
      for (const index of [0, 1]) {
        const mark = await chart
          .locator('[data-slot="metric-visible-nodes"] .instrument-chart-point')
          .nth(index)
          .boundingBox();
        await page.mouse.click(
          mark!.x + mark!.width / 2,
          mark!.y + mark!.height / 2,
        );
        await expect(chart.getByRole("group")).toContainText(
          index === 0 ? "12:00:00" : "12:01:00",
        );
      }
      await chart
        .getByRole("combobox", {
          name: "Inspect Request Volume sample",
          exact: true,
        })
        .click();
      await page
        .getByRole("option", { name: /2026-10-24 12:20:00.*UTC/ })
        .click();
      await expect(chart.getByRole("group")).toContainText("24");
      await chart
        .getByRole("combobox", {
          name: "Inspect Request Volume sample",
          exact: true,
        })
        .click();
      await page
        .getByRole("option", { name: /2026-10-24 12:02:00.*No samples/ })
        .click();
      await expect(chart.getByRole("group")).toContainText("No samples");
      await chart
        .getByRole("combobox", {
          name: "Inspect Request Volume sample",
          exact: true,
        })
        .click();
      await page
        .getByRole("option", { name: /2026-10-24 12:00:00.*UTC/ })
        .click();
      await expect(chart.getByRole("group")).toContainText("0");
      expect(await chart.locator("[title], svg title").count()).toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `/tmp/crate-health-instruments-${width}-oct24.png`,
      });
      expect(adminApi.calls).toEqual([]);
    });
  });
}
