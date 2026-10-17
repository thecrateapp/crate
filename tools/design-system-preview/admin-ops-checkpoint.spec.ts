import { expect, test } from "@playwright/test";
for (const width of [1440, 768, 390]) {
  test.describe(`Admin operational surfaces ${width}`, () => {
    test.use({
      viewport: { width, height: 1100 },
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    test("1Y keeps text hierarchy, status and functional slot controls", async ({
      page,
    }, info) => {
      const errors: string[] = [],
        requests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.url().includes("/api/")) requests.push(request.url());
      });
      await page.goto("/?tab=albums&listenTab=history#superficies-admin");
      const section = page.getByRole("region", {
        name: "Checkpoint 1Y, Superficies operativas de Admin",
      });
      await expect(section).toBeVisible();
      const hero = section.getByTestId("ops-hero"),
        stats = section.getByTestId("ops-stats");
      await expect(
        hero.getByRole("heading", { level: 1, name: "Operaciones de muestra" }),
      ).toBeVisible();
      await expect(hero.locator("svg")).toHaveCount(0);
      await expect(stats.locator("svg")).toHaveCount(0);
      await expect(stats.getByText("0", { exact: true })).toBeVisible();
      for (const [label, value, colour] of [
        ["En servicio", "7/8", "--accent-action-hi"],
        ["Trabajos fallidos", "1", "--state-warning-text"],
        ["Pendientes", "3", "--state-warning-text"],
      ] as const) {
        const tile = stats
          .locator("[data-sample-stat]")
          .filter({ hasText: label });
        await expect(tile.getByText(value, { exact: true })).toBeVisible();
        const labelBox = await tile
          .getByText(label, { exact: true })
          .boundingBox();
        const valueBox = await tile
          .getByText(value, { exact: true })
          .boundingBox();
        expect(valueBox!.y - labelBox!.y - labelBox!.height).toBe(8);
        expect(
          await tile
            .getByText(value, { exact: true })
            .evaluate((node, token) => {
              const probe = document.createElement("span");
              probe.style.color = `var(${token})`;
              node.append(probe);
              const matches =
                getComputedStyle(node).color === getComputedStyle(probe).color;
              probe.remove();
              return matches;
            }, colour),
        ).toBe(true);
      }
      const refresh = hero.getByRole("button", { name: "Actualizar muestra" });
      await refresh.focus();
      await expect(refresh).toBeFocused();
      await refresh.press("Enter");
      await expect(refresh).toBeDisabled();
      await expect(refresh).toHaveAttribute("aria-busy", "true");
      await expect(refresh.locator("svg")).toHaveCount(1);
      await section
        .getByRole("button", { name: "Completar actualización" })
        .click();
      await expect(refresh).toBeEnabled();
      await expect(hero.getByRole("status")).toHaveText(
        "Muestra actualizada · 1",
      );
      await expect(refresh.locator("svg")).toHaveCount(0);
      const disclosure = section.getByRole("button", {
        name: "Detalles de las colas",
      });
      await expect(disclosure.locator("svg")).toHaveCount(1);
      await expect(disclosure).toHaveAttribute("aria-expanded", "false");
      await disclosure.focus();
      await disclosure.press("Space");
      await expect(disclosure).toHaveAttribute("aria-expanded", "true");
      await expect(
        section.getByRole("region", { name: "Detalle de colas de muestra" }),
      ).toContainText("Sin tareas en espera");
      await disclosure.press("Space");
      await expect(
        section.getByRole("region", { name: "Detalle de colas de muestra" }),
      ).toBeHidden();
      for (const target of [refresh, disclosure]) {
        const box = await target.boundingBox();
        expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
      }
      await expect(
        section.getByRole("link", { name: "Revisar controles de Admin" }),
      ).toHaveAttribute("href", "#controles-admin");
      expect(
        await section.evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(new URL(page.url()).search).toBe("?tab=albums&listenTab=history");
      expect(errors).toEqual([]);
      expect(requests).toEqual([]);
      await section.scrollIntoViewIfNeeded();
      await info.attach("checkpoint-1y", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    });
  });
}
test("1Y preserves earlier checkpoints and records 1X as published", async ({
  page,
}) => {
  await page.goto("/#superficies-admin");
  await expect(
    page.getByRole("region", { name: "Checkpoint 1X, Controles de Admin" }),
  ).toContainText("Publicado");
  await expect(
    page.getByRole("region", {
      name: "Checkpoint 1T, Colores de estado de Admin",
    }),
  ).toBeAttached();
  await expect(
    page.getByLabel("Indicadores reales de Admin").locator("svg"),
  ).toHaveCount(0);
});
