import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test.describe(`Observability integrity ${width}`, () => {
    test.use({
      viewport: { width, height: 1000 },
      isMobile: width === 390,
      hasTouch: width === 390,
    });

    test("keeps unavailable, empty, partial, stale and legacy samples out of healthy state", async ({
      page,
    }) => {
      const errors: string[] = [];
      const apiRequests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/"))
          apiRequests.push(request.url());
      });

      const response = await page.goto("/review-observability-integrity.html");
      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole("heading", { name: "System Health", exact: true }),
      ).toBeVisible();
      const samples = page.getByRole("radiogroup", { name: "Metrics sample" });
      const summary = page.locator('[data-slot="system-health-summary"]');
      const score = summary
        .getByText("Health Score", { exact: true })
        .locator("..");
      const errorsTile = summary
        .getByText("Error Rate", { exact: true })
        .locator("..");

      await samples
        .getByRole("radio", { name: "Observed", exact: true })
        .click();
      await expect(score).toContainText("100");
      await expect(errorsTile).toContainText("0.00%");
      const provenance = page.getByRole("status", {
        name: "Metrics provenance",
      });
      await expect(provenance).toContainText(/120 observed requests/i);
      await expect(provenance).toContainText(/Minute history retains 8 days/i);
      await expect(page.getByText(/Core services look stable/i)).toHaveCount(0);
      const chart = page.getByRole("region", {
        name: "API Latency",
        exact: true,
      });
      const source = chart.locator("header").getByText(/^Source:/);
      await expect(source).toContainText("PostgreSQL v2");
      const observed = (await source.textContent())?.match(
        /observed\s+(\S+)/,
      )?.[1];
      expect(observed).toBeTruthy();
      const observedAt = Date.parse(observed!);
      expect(Date.now() - observedAt).toBeGreaterThanOrEqual(300_000);
      expect(Date.now() - observedAt).toBeLessThan(600_000);
      await chart
        .getByRole("combobox", { name: "Inspect API Latency sample" })
        .click();
      const lastSample = (await page
        .getByRole("option")
        .last()
        .textContent())!.trim();
      const lastSampleAt = Date.parse(
        lastSample.replace(" UTC", "Z").replace(" ", "T"),
      );
      expect(lastSampleAt).toBe(observedAt);
      await page.keyboard.press("Escape");

      for (const state of [
        "Redis unavailable",
        "Empty",
        "Partial",
        "Stale",
        "Legacy",
      ]) {
        await samples.getByRole("radio", { name: state, exact: true }).click();
        await expect(score).toContainText("—");
        await expect(score).not.toContainText("100");
        await expect(page.getByText(/Core services look stable/i)).toHaveCount(
          0,
        );
        if (state === "Empty") {
          await expect(source).toContainText("empty");
          await expect(
            chart.getByText("No observed samples", { exact: true }),
          ).toBeVisible();
          await expect(chart.getByRole("combobox")).toHaveCount(0);
        }
        if (state === "Redis unavailable") {
          await expect(source).toContainText("PostgreSQL v2");
          await expect(chart.getByRole("combobox")).toBeVisible();
        }
        if (state === "Partial") {
          await expect(provenance).toContainText("3 dropped observations");
          await expect(chart.getByRole("combobox")).toBeVisible();
        }
        if (state === "Legacy") {
          await expect(
            chart.getByText("Source unverified", { exact: true }),
          ).toBeVisible();
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }

      await samples
        .getByRole("radio", { name: "Observed", exact: true })
        .click();
      await expect(score).toContainText("100");
      await expect(provenance).toContainText(/Redis v2/i);
      expect(errors).toEqual([]);
      expect(apiRequests).toEqual([]);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `.artifacts/observability-integrity-${width}.png`,
        animations: "disabled",
      });
    });
  });
}
