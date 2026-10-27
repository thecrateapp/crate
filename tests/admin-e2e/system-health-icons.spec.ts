import { emulateCoarsePointer, expect, test } from "./fixtures";
import fixture from "./fixtures/system-health-1ac.json";

for (const width of [1440, 768, 390])
  test.describe(`System Health icon retirement ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test("keeps built instruments, 8px readings and working metric controls", async ({
      page,
      openAdminPage,
      adminApi,
    }) => {
      adminApi.respondTo("/api/admin/metrics/dashboard", fixture);
      const queries: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("/api/admin/metrics/dashboard?"))
          queries.push(new URL(r.url()).search);
      });
      await openAdminPage("/system");
      const main = page.getByRole("main");
      await expect(main.locator("svg.lucide")).toHaveCount(1);
      await expect(
        main.locator('svg[data-admin-ux="header-refresh-metrics"]'),
      ).toHaveCount(1);
      await expect(main.locator("svg").first()).toBeVisible();
      await expect(
        main.getByRole("heading", { name: "System Health", exact: true }),
      ).toHaveCSS("font-family", /Bricolage Grotesque/);
      await expect(main.getByText("Music Volume", { exact: true })).toHaveCSS(
        "font-family",
        /JetBrains Mono/,
      );
      await expect(main.getByText("280 / 1000 GB", { exact: true })).toHaveCSS(
        "font-family",
        /JetBrains Mono/,
      );
      const gaps = await main
        .locator(".crate-form-field")
        .evaluateAll((nodes) =>
          nodes.map(
            (n) =>
              n.children[1]!.getBoundingClientRect().top -
              n.children[0]!.getBoundingClientRect().bottom,
          ),
        );
      expect(gaps.length).toBeGreaterThan(20);
      expect(gaps.every((gap) => gap === 8)).toBe(true);
      const window = main.getByRole("radiogroup", { name: "Metrics window" });
      await window.getByRole("radio", { name: "1h", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      await expect(
        window.getByRole("radio", { name: "24h", exact: true }),
      ).toBeChecked();
      await expect.poll(() => queries).toContain("?period=hour&minutes=1440");
      const count = queries.length;
      const refresh = main.getByRole("button", {
        name: "Refresh metrics",
        exact: true,
      });
      await refresh.click();
      await expect.poll(() => queries.length).toBeGreaterThan(count);
      await emulateCoarsePointer(page);
      const coarse = await page.evaluate(
        () => matchMedia("(pointer: coarse)").matches,
      );
      for (const target of await main.locator("button").all()) {
        const box = await target.boundingBox();
        const minimum =
          (await target.getAttribute("role")) === "radio" && !coarse ? 32 : 44;
        expect(Math.min(box!.height, box!.width)).toBeGreaterThanOrEqual(
          minimum,
        );
      }
      await expect(
        main.getByRole("meter", { name: /Transcode slots/i }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  });

test("keeps long task and route text inside the mobile System Health page", async ({
  page,
  openAdminPage,
  adminApi,
}) => {
  await page.setViewportSize({ width: 390, height: 1100 });
  const data = structuredClone(fixture),
    long = "LongSystemMeasurement".repeat(20);
  data.tasks[0]!.label = long;
  data.tasks[0]!.progress = JSON.stringify({
    percent: 25,
    phase: long,
    item: long,
  });
  data.route_latency[0]!.path = `/api/${long}`;
  data.system.resource_pressure.reason = long;
  adminApi.respondTo("/api/admin/metrics/dashboard", data);
  await openAdminPage("/system");
  await expect(
    page.getByRole("main").getByText(long, { exact: true }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
