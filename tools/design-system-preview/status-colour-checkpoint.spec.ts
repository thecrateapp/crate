import { expect, test } from "@playwright/test";
for (const width of [1440, 390]) {
  test.describe(`Admin status colours ${width}`, () => {
    test.use({
      viewport: { width, height: 1000 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    test("1T keeps words, neutral severity and danger only inside confirmation", async ({
      page,
    }, info) => {
      const errors: string[] = [];
      const api: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.url().includes("/api/")) api.push(request.url());
      });
      await page.addInitScript(() => {
        const writes: string[] = [];
        Reflect.set(window, "__statusWrites", writes);
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          writes.push(key);
          original.call(this, key, value);
        };
      });
      await page.goto("/#estado-admin");
      const section = page.getByRole("region", {
        name: "Checkpoint 1T, Colores de estado de Admin",
      });
      await expect(section).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const selected = section.getByRole("status", {
        name: "Estado seleccionado",
      });
      await expect(selected).toHaveText("Fallido");
      const warning = await selected
        .locator("[data-tone]")
        .evaluate((element) => getComputedStyle(element).color);
      await expect(section.getByText("1", { exact: true })).toHaveCSS(
        "color",
        warning,
      );
      await expect(section.getByText("3", { exact: true })).toHaveCSS(
        "color",
        warning,
      );
      await section.getByRole("radio", { name: "Activo", exact: true }).click();
      await expect(selected).toHaveText("Activo");
      const accent = await selected
        .locator("[data-tone]")
        .evaluate((element) => getComputedStyle(element).color);
      expect(accent).not.toBe(warning);
      await expect(section.getByText("7/8")).toHaveCSS("color", accent);
      await section
        .getByRole("radio", { name: "Sin actividad", exact: true })
        .click();
      await expect(selected.locator("[data-tone]")).toHaveAttribute(
        "data-tone",
        "off",
      );
      await section
        .getByRole("radio", { name: "Fallido", exact: true })
        .focus();
      await page.keyboard.press("Space");
      await expect(selected).toHaveText("Fallido");
      for (const label of [
        "Riesgo en gris",
        "Niveles de log en gris",
        "Incidencia real de Admin",
      ]) {
        const figure = section.getByRole("figure", { name: label });
        const segments = figure.locator("[data-segment]");
        expect(await segments.count()).toBeGreaterThanOrEqual(3);
        for (const segment of await segments.all()) {
          const colour = await segment.evaluate(
            (element) => getComputedStyle(element).backgroundColor,
          );
          const channels = colour
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number);
          expect(Math.max(...channels) - Math.min(...channels)).toBeLessThan(
            16,
          );
        }
      }
      await expect(section.getByText("Servicio sin respuesta")).toBeVisible();
      await expect(
        section.getByText("critical", { exact: true }),
      ).toBeVisible();
      await expect(section.locator('[data-variant="destructive"]')).toHaveCount(
        0,
      );
      const trigger = section.getByRole("button", {
        name: "Revisar acción de muestra",
      });
      await trigger.click();
      const dialog = page.getByRole("alertdialog", {
        name: "Vaciar cola de muestra",
      });
      await expect(dialog).toBeVisible();
      const confirm = dialog.getByRole("button", {
        name: "Vaciar muestra",
        exact: true,
      });
      await expect(confirm).toHaveAttribute("data-variant", "destructive");
      await expect(page.locator('[data-variant="destructive"]')).toHaveCount(1);
      await dialog
        .getByRole("button", { name: "Cancelar", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      const outcome = section.getByRole("status", {
        name: "Resultado de la muestra",
      });
      await expect(outcome).toContainText("No se ha modificado la biblioteca");
      const labelBox = (await section
        .locator("#status-outcome-label")
        .boundingBox())!;
      const outputBox = (await outcome.boundingBox())!;
      expect(outputBox.y - labelBox.y - labelBox.height).toBeCloseTo(8, 0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
      expect(api).toEqual([]);
      expect(
        await page.evaluate(() => Reflect.get(window, "__statusWrites")),
      ).toEqual([]);
      const height = await section.evaluate((element) =>
        Math.ceil(element.getBoundingClientRect().height),
      );
      await page.setViewportSize({ width, height: height + 64 });
      await section.scrollIntoViewIfNeeded();
      await section.screenshot({
        path: info.outputPath(`checkpoint-1t-${width}.png`),
        animations: "disabled",
      });
    });
  });
}
