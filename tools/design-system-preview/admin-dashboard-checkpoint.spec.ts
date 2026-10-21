import { expect, test } from "@playwright/test";
test("1AB embeds the three real Dashboard blocks and preserves prior checkpoints", async ({
  page,
}) => {
  await page.goto("/?tab=albums&listenTab=history#dashboard-admin");
  const section = page.getByRole("region", {
    name: "Checkpoint 1AB, Dashboard de Admin",
  });
  await expect(
    section
      .frameLocator("iframe")
      .getByRole("region", { name: "System", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#analisis-admin")).toHaveCount(1);
  await expect(page.locator("footer")).toContainText("1AA publicado");
  await expect(page.locator("footer")).toContainText("1AB publicado");
});
for (const width of [1440, 768, 390])
  test.describe(`Three-block Dashboard ${width}`, () => {
    test.use({
      viewport: { width, height: 1100 },
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    test("keeps measured states, progress, keyboard, maintenance and an uncluttered responsive page", async ({
      page,
    }) => {
      const errors: string[] = [],
        network: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      page.on("request", (r) => {
        if (r.url().includes("/api/")) network.push(r.url());
      });
      await page.goto("/admin-dashboard-demo.html");
      const real = page.getByRole("region", {
        name: "Página real de Admin",
        exact: true,
      });
      await expect(real.getByRole("region")).toHaveCount(3);
      await expect(
        real.getByText("Reported services responding", { exact: true }),
      ).toBeVisible();
      await expect(
        real.getByRole("progressbar", {
          name: "Reported progress: Artist enrichment",
        }),
      ).toHaveAttribute("aria-valuenow", "25");
      for (const name of [
        "Right Now",
        "Pipeline",
        "Library Changes",
        "Advanced Diagnostics",
      ])
        await expect(
          real.getByRole("heading", { name, exact: true }),
        ).toHaveCount(0);
      await expect(
        real.getByRole("heading", { name: "Dashboard", exact: true }),
      ).toHaveCSS("font-family", /Bricolage Grotesque/);
      await expect(
        real.getByRole("button", { name: "Refresh", exact: true }),
      ).toHaveCSS("font-family", /^"IBM Plex Sans"/);
      const pairs = await real
        .locator(".crate-form-field")
        .evaluateAll((nodes) =>
          nodes.map(
            (n) =>
              n.children[1]!.getBoundingClientRect().top -
              n.children[0]!.getBoundingClientRect().bottom,
          ),
        );
      expect(pairs).toEqual([8, 8]);
      for (const target of await real.locator("button,a").all()) {
        const box = await target.boundingBox();
        expect(Math.min(box!.height, box!.width)).toBeGreaterThanOrEqual(44);
      }
      await real
        .getByRole("link", { name: "Artist enrichment", exact: true })
        .click();
      await expect(
        page.getByRole("status", { name: "Ruta de muestra" }),
      ).toHaveText("/tasks?task=sample-running");
      await page
        .getByRole("button", { name: "Volver a Dashboard", exact: true })
        .click();
      const maintenance = real.getByRole("button", {
        name: "Maintenance",
        exact: true,
      });
      await maintenance.focus();
      await maintenance.press("Enter");
      let panel = page.getByRole("dialog", {
        name: "Library maintenance",
        exact: true,
      });
      await expect(panel).toBeVisible();
      await panel
        .getByRole("button", { name: "Sync library", exact: true })
        .click();
      await expect(
        page.getByRole("status", { name: "Última acción de muestra" }),
      ).toContainText("POST /api/tasks/sync-library");
      for (const [trigger, confirm, word, path] of [
        [
          "Rebuild library",
          "Rebuild Library",
          "REBUILD",
          "/api/manage/rebuild",
        ],
        ["Wipe database", "Wipe Database", "WIPE", "/api/manage/wipe"],
      ]) {
        const open = panel.getByRole("button", { name: trigger, exact: true });
        await open.click();
        let dialog = page.getByRole("alertdialog");
        await expect(
          dialog.getByRole("button", { name: confirm, exact: true }),
        ).toBeDisabled();
        await dialog
          .getByRole("button", { name: "Cancel", exact: true })
          .click();
        await expect(open).toBeFocused();
        await open.click();
        dialog = page.getByRole("alertdialog");
        await dialog.getByLabel(`Type ${word} to confirm`).fill(word!);
        await dialog
          .getByRole("button", { name: confirm, exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
        await expect(panel).toBeVisible();
        await expect(
          page.getByRole("status", { name: "Última acción de muestra" }),
        ).toContainText(`POST ${path}`);
      }
      await panel
        .getByRole("button", { name: "Close maintenance", exact: true })
        .click();
      await expect(maintenance).toBeFocused();
      await page
        .getByRole("checkbox", { name: "Permitir mantenimiento de muestra" })
        .uncheck();
      await maintenance.click();
      panel = page.getByRole("dialog", {
        name: "Library maintenance",
        exact: true,
      });
      await expect(
        panel.getByRole("button", { name: "Wipe database", exact: true }),
      ).toHaveCount(0);
      await panel.press("Escape");
      await expect(panel).toHaveCount(0);
      await page
        .getByRole("radio", { name: "Interrupción", exact: true })
        .click();
      await expect(
        real.getByText("PostgreSQL reported offline", { exact: true }),
      ).toBeVisible();
      const regions = await real
        .getByRole("region")
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
      expect(regions).toEqual([
        "System",
        "Needs attention",
        "Work in progress",
      ]);
      await page
        .getByRole("radio", { name: "Desactualizado", exact: true })
        .click();
      await expect(
        real.getByText("Report out of date", { exact: true }),
      ).toBeVisible();
      await expect(
        real.getByText("PostgreSQL reported offline", { exact: true }),
      ).toHaveCount(0);
      await real.getByRole("button", { name: "Refresh", exact: true }).click();
      await expect(
        real.getByText("Reported services responding", { exact: true }),
      ).toBeVisible();
      await page.getByRole("radio", { name: "Parcial", exact: true }).click();
      await expect(real.getByText("Unreported", { exact: true })).toHaveCount(
        2,
      );
      await expect(
        real.getByText("Task queue totals unavailable.", { exact: true }),
      ).toBeVisible();
      await page.getByRole("radio", { name: "En reposo", exact: true }).click();
      await expect(
        real.getByText("No task rows reported.", { exact: true }),
      ).toBeVisible();
      await expect(real.getByRole("progressbar")).toHaveCount(0);
      await page.getByRole("radio", { name: "Cargando", exact: true }).click();
      await expect(
        real.getByRole("status", { name: "Loading dashboard", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("radio", { name: "Sin servicio", exact: true })
        .click();
      await expect(real.getByRole("alert")).toContainText(
        "Failed to load dashboard",
      );
      await real.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(real.getByRole("region")).toHaveCount(3);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
      expect(network).toEqual([]);
    });
  });
test("expires the displayed report without another network request", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/admin-dashboard-demo.html");
  const real = page.getByRole("region", {
    name: "Página real de Admin",
    exact: true,
  });
  await expect(
    real.getByText("Reported services responding", { exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(61001);
  await expect(
    real.getByText("Report out of date", { exact: true }),
  ).toBeVisible();
});
