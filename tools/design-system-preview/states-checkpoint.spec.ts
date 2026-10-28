import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test.describe(`shared states ${width}`, () => {
    test.use({
      viewport: { width, height: 1000 },
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    test("checkpoint 1R reserves geometry and keeps error, retry and offline behavior accessible", async ({
      page,
    }, info) => {
      const requests: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/api/")) requests.push(request.url());
      });
      await page.addInitScript(() => {
        const writes: string[] = [];
        Reflect.set(window, "__statesStorageWrites", writes);
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          writes.push(key);
          return original.call(this, key, value);
        };
      });
      await page.goto("/#estados");
      const section = page.getByRole("region", {
        name: "Checkpoint 1R, Estados",
      });
      await section.scrollIntoViewIfNeeded();
      const instrument = section.getByRole("figure", {
        name: "Instrumento de muestra",
      });
      const reserved = instrument.locator(".state-preview-reserved");
      const height = (await reserved.boundingBox())!.height;
      const readingHeight = (await instrument
        .locator('[aria-label="Valores de muestra"]')
        .boundingBox())!.height;
      await expect(
        instrument.getByRole("status", { name: "Cargando lecturas" }),
      ).toBeVisible();
      await expect(instrument.locator("header [aria-live]")).toHaveCount(0);
      expect(
        await instrument.locator('[data-slot="skeleton-table"]').count(),
      ).toBe(0);
      for (const skeleton of await section
        .locator('[data-slot="skeleton"]')
        .all()) {
        await expect(skeleton).toHaveCSS("animation-name", "none");
      }
      const grid = section.getByRole("figure", {
        name: "Cuadrícula de muestra",
      });
      const cover = grid
        .locator('[data-slot="skeleton-cover"] [data-slot="skeleton"]')
        .first();
      const box = (await cover.boundingBox())!;
      expect(box.width).toBeCloseTo(box.height, 0);
      for (const kind of ["artist", "album"]) {
        const comparison = section.locator(`[data-geometry="${kind}"]`);
        const placeholder = (await comparison
          .locator('[data-slot="skeleton-cover"]')
          .boundingBox())!;
        const artwork = (await comparison
          .locator('[data-slot="skeleton-cover"] .crate-skeleton')
          .boundingBox())!;
        const readyArtwork = (await comparison
          .locator('[data-slot="entity-artwork"]')
          .boundingBox())!;
        const readyCard = (await comparison.locator("article").boundingBox())!;
        expect(artwork.width).toBeCloseTo(readyArtwork.width, 0);
        expect(artwork.height).toBeCloseTo(readyArtwork.height, 0);
        expect(placeholder.height).toBeCloseTo(readyCard.height, 0);
      }
      const table = section.getByRole("figure", { name: "Tabla de muestra" });
      expect(
        (await table.locator("thead tr").boundingBox())!.height,
      ).toBeCloseTo(32, 0);
      for (const row of await table.locator("tbody tr").all())
        expect((await row.boundingBox())!.height).toBeCloseTo(44, 0);

      const choices = section.getByRole("radiogroup", {
        name: "Estado de la muestra",
      });
      const labelGap = await choices.evaluate(
        (el) =>
          el.getBoundingClientRect().top -
          el.previousElementSibling!.getBoundingClientRect().bottom,
      );
      expect(labelGap).toBe(8);
      if (width === 390) {
        const heading = section.locator(".specimen-heading");
        const title = (await heading.locator("h2").boundingBox())!;
        const body = (await heading.locator(":scope > p").boundingBox())!;
        expect(body.y - title.y - title.height).toBeGreaterThanOrEqual(16);
      }
      await choices.getByRole("radio", { name: "Listo", exact: true }).click();
      await expect(instrument).toContainText("124");
      expect(
        (await instrument
          .locator('[aria-label="Valores de muestra"]')
          .boundingBox())!.height,
      ).toBe(readingHeight);
      await choices.getByRole("radio", { name: "Error", exact: true }).click();
      await expect(
        instrument.getByRole("alert", { name: "No se pudo actualizar" }),
      ).toBeVisible();
      await expect(instrument).toContainText("124");
      await instrument
        .getByRole("button", { name: "Reintentar", exact: true })
        .click();
      await expect(instrument).toContainText("Actualizando");
      await expect(instrument).toContainText("124");
      expect((await reserved.boundingBox())!.height).toBe(height);
      await choices
        .getByRole("radio", { name: "Desactualizado", exact: true })
        .click();
      await expect(instrument).toContainText("Última lectura de muestra");
      await expect(instrument).toContainText("124");
      await choices
        .getByRole("radio", { name: "Sin conexión", exact: true })
        .click();
      await expect(
        instrument.getByRole("button", { name: "Actualizar", exact: true }),
      ).toBeDisabled();
      await expect(instrument).toContainText(
        "Conecta de nuevo para actualizar",
      );
      await expect(instrument).toContainText("124");
      await choices
        .getByRole("radio", { name: "Construyendo", exact: true })
        .click();
      await expect(instrument).toContainText("Esperando al proyector");
      await expect(instrument).not.toContainText("124");
      await choices.getByRole("radio", { name: "Error", exact: true }).click();
      await expect(
        instrument.getByRole("alert", { name: "No se pudo cargar" }),
      ).toBeVisible();
      await expect(instrument.getByRole("alert").locator("h2")).toHaveCSS(
        "font-size",
        "20px",
      );
      await choices.getByRole("radio", { name: "Vacío", exact: true }).click();
      const empty = instrument.getByRole("status", { name: "Sin lecturas" });
      await expect(empty).toBeVisible();
      await expect(empty).toHaveCSS("border-style", "solid");
      await expect(empty).toHaveCSS("border-width", "0px");
      expect((await reserved.boundingBox())!.height).toBe(height);
      await empty.getByRole("button", { name: "Cargar muestra" }).focus();
      await page.keyboard.press("Enter");
      await expect(
        instrument.getByRole("status", { name: "Cargando lecturas" }),
      ).toBeVisible();
      await section.getByRole("button", { name: "Reintentar ejemplo" }).click();
      await expect(
        section.getByRole("status", { name: "Resultado de la muestra" }),
      ).toHaveText("Reintento de muestra solicitado.");
      await expect(
        section
          .getByRole("alert")
          .locator("h2")
          .locator("..")
          .locator(".crate-status-dot"),
      ).toHaveCount(0);
      const pageError = section.getByRole("alert", {
        name: "El servicio no está disponible",
      });
      const identifier = pageError.locator(".crate-status-dot");
      const label = pageError.getByText("Error de servicio · 503");
      const dotBox = (await identifier.boundingBox())!;
      const labelBox = (await label.boundingBox())!;
      expect(dotBox.y).toBeGreaterThanOrEqual(labelBox.y);
      expect(dotBox.y + dotBox.height).toBeLessThanOrEqual(
        labelBox.y + labelBox.height,
      );
      await expect(pageError.locator("h2")).toHaveCSS("font-size", "40px");
      await expect(pageError.locator("h2")).toHaveCSS("font-weight", "800");
      expect(
        await section.locator("svg, .animate-spin, .animate-pulse").count(),
      ).toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(requests).toEqual([]);
      expect(
        await page.evaluate(() => Reflect.get(window, "__statesStorageWrites")),
      ).toEqual([]);
      const viewport = page.viewportSize()!;
      const sectionHeight = await section.evaluate((element) =>
        Math.ceil(element.getBoundingClientRect().height),
      );
      await page.setViewportSize({
        width: viewport.width,
        height: Math.max(viewport.height, sectionHeight + 64),
      });
      await section.scrollIntoViewIfNeeded();
      const image = info.outputPath(`checkpoint-1r-${width}.png`);
      await section.screenshot({ path: image, animations: "disabled" });
      await info.attach("Checkpoint 1R advisory", {
        path: image,
        contentType: "image/png",
      });
    });
  });
}

test("shared route indicators wait 200ms and keep their 120px reserved geometry", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-16T12:00:00Z") });
  await page.goto("/#estados");
  await page.clock.pauseAt(new Date("2026-10-16T12:01:00Z"));
  const route = page.getByRole("figure", { name: "Carga de ruta de muestra" });
  const reserved = route.locator(".state-preview-route");
  const height = (await reserved.boundingBox())!.height;
  await route.getByRole("button", { name: "Reiniciar carga de ruta" }).click();
  await expect(route.getByRole("progressbar")).toHaveCount(0);
  await page.clock.runFor(199);
  await expect(route.getByRole("progressbar")).toHaveCount(0);
  await page.clock.runFor(1);
  const progress = route.getByRole("progressbar", { name: "Cargando ruta" });
  await expect(progress).toBeVisible();
  expect((await progress.boundingBox())!.width).toBe(120);
  expect((await reserved.boundingBox())!.height).toBe(height);
  await expect(progress).not.toHaveAttribute("aria-valuenow");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(progress).not.toHaveAttribute("data-animated");
});
