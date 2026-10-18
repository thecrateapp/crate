import { expect, test } from "@playwright/test";

test("1AC embeds real System Health and preserves published checkpoints", async ({
  page,
}) => {
  await page.goto("/?tab=albums&listenTab=history#sistema-admin");
  const checkpoint = page.getByRole("region", {
    name: "Checkpoint 1AC, System Health de Admin",
  });
  await expect(
    checkpoint
      .frameLocator("iframe")
      .getByRole("heading", { name: "System Health", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#dashboard-admin")).toHaveCount(1);
  await expect(page.locator("footer")).toContainText("1AB publicado");
  await expect(page.locator("footer")).toContainText("1AC publicado");
});

for (const width of [1440, 768, 390])
  test.describe(`System Health ${width}`, () => {
    test.use({
      viewport: { width, height: 1100 },
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    test("preserves metrics, instruments, radio keyboard and local refresh without page glyphs", async ({
      page,
    }) => {
      const errors: string[] = [],
        requests: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        if (r.url().includes("/api/")) requests.push(r.url());
      });
      await page.goto("/admin-system-health-demo.html");
      const real = page.getByRole("region", {
        name: "Página real de Admin",
        exact: true,
      });
      await expect(
        real.getByRole("heading", { name: "System Health", exact: true }),
      ).toHaveCSS("font-family", /Bricolage Grotesque/);
      await expect(real.getByText("Music Volume", { exact: true })).toHaveCSS(
        "font-family",
        /JetBrains Mono/,
      );
      await expect(real.getByText("280 / 1000 GB", { exact: true })).toHaveCSS(
        "font-family",
        /Bricolage Grotesque/,
      );
      const refresh = real.getByRole("button", {
        name: "Refresh metrics",
        exact: true,
      });
      await expect(refresh).toHaveCSS("font-family", /^Poppins/);
      await expect(real.locator("svg.lucide")).toHaveCount(0);
      await expect(
        real.getByRole("meter", { name: "Transcode Slots" }),
      ).toHaveAttribute("aria-valuenow", "1");
      await expect(real.locator("svg").first()).toBeVisible();
      const coarse = await page.evaluate(
        () => matchMedia("(pointer: coarse)").matches,
      );
      for (const button of await real.locator("button").all()) {
        const box = await button.boundingBox();
        const minimum =
          (await button.getAttribute("role")) === "radio" && !coarse ? 32 : 44;
        expect(Math.min(box!.height, box!.width)).toBeGreaterThanOrEqual(
          minimum,
        );
      }
      const fields = await real
        .locator(".crate-form-field")
        .evaluateAll((nodes) =>
          nodes.map((n) => ({
            gap:
              n.children[1]!.getBoundingClientRect().top -
              n.children[0]!.getBoundingClientRect().bottom,
            label: n.children[0]!.textContent,
          })),
        );
      expect(fields.length).toBeGreaterThan(20);
      for (const field of fields) expect(field.gap, field.label!).toBe(8);
      const window = real.getByRole("radiogroup", { name: "Metrics window" });
      await window.getByRole("radio", { name: "1h", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      await expect(
        window.getByRole("radio", { name: "24h", exact: true }),
      ).toBeChecked();
      await expect(
        page.getByRole("status", { name: "Consulta de muestra" }),
      ).toHaveText("/api/admin/metrics/dashboard?period=hour&minutes=1440");
      await refresh.click();
      await expect(
        page.getByRole("status", { name: "Actualizaciones de muestra" }),
      ).toHaveText("Actualizaciones locales: 1");
      await page.getByRole("radio", { name: "Presión", exact: true }).click();
      await expect(
        real.getByText("Batch deferred", { exact: true }),
      ).toBeVisible();
      await expect(real.getByText("Deferring", { exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
      expect(requests).toEqual([]);
    });
  });
