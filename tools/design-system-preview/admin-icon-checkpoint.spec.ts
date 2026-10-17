import { expect, test } from "@playwright/test";
for (const width of [1440, 390]) {
  test.describe(`Admin icon inventory ${width}`, () => {
    test.use({
      viewport: { width, height: 1000 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    test("1V shows review scope, keyboard actions and a bounded searchable inventory", async ({
      page,
    }, info) => {
      const errors: string[] = [],
        api: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.url().includes("/api/")) api.push(request.url());
      });
      await page.goto("/?tab=albums&listenTab=history#iconos-admin");
      const section = page.getByRole("region", {
        name: "Checkpoint 1V, Inventario de iconos de Admin",
      });
      await expect(section).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expect(section.getByText("142", { exact: true })).toBeVisible();
      await expect(section.getByText("72", { exact: true })).toBeVisible();
      await expect(section.getByText("0", { exact: true })).toBeVisible();
      const files = section.getByRole("list", {
        name: "Archivos del inventario",
      });
      await expect(files.locator("li")).toHaveCount(8);
      await section
        .getByRole("button", { name: "Mostrar 8 archivos más" })
        .click();
      await expect(files.locator("li")).toHaveCount(16);
      const filter = section.getByLabel("Filtrar archivos del inventario");
      const gap = await filter.evaluate(
        (input) =>
          input.getBoundingClientRect().top -
          input.previousElementSibling!.getBoundingClientRect().bottom,
      );
      expect(gap).toBe(8);
      await filter.fill("layout/Sidebar");
      await expect(files.locator("li")).toHaveCount(1);
      const detail = files.locator("summary");
      await detail.focus();
      await page.keyboard.press("Enter");
      await expect(files.getByText("Mapas y propiedades")).toBeVisible();
      await filter.fill("sin-resultados-ficticios");
      await expect(files.locator("li")).toHaveCount(0);
      await expect(
        section.getByRole("status", { name: "Archivos encontrados" }),
      ).toHaveText("0 archivos con referencias · se muestran 0");
      await filter.fill("");
      await expect(files.locator("li")).toHaveCount(8);
      const actions = section.getByRole("group", {
        name: "Acciones tipográficas de muestra",
      });
      const close = actions.getByRole("button", {
        name: "Cerrar",
        exact: true,
      });
      await close.focus();
      await page.keyboard.press("Enter");
      await expect(
        section.getByRole("status", {
          name: "Resultado de la muestra de texto",
        }),
      ).toHaveText("Muestra cerrada.");
      await actions
        .getByRole("button", { name: "Descargar", exact: true })
        .click();
      await expect(
        section.getByRole("status", {
          name: "Resultado de la muestra de texto",
        }),
      ).toHaveText("Descarga de muestra solicitada.");
      for (const button of await actions.getByRole("button").all()) {
        const box = await button.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      const proposals = section.getByRole("list", {
        name: "Propuestas por control",
      });
      await expect(proposals.locator("li")).toHaveCount(25);
      const qr = proposals
        .locator("details")
        .filter({ has: page.locator("summary", { hasText: "Código QR" }) });
      await qr.locator("summary").click();
      await expect(qr.getByText(/es contenido funcional/)).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(new URL(page.url()).search).toBe("?tab=albums&listenTab=history");
      expect(api).toEqual([]);
      expect(errors).toEqual([]);
      await section.scrollIntoViewIfNeeded();
      await info.attach("checkpoint-1v", {
        body: await section.screenshot(),
        contentType: "image/png",
      });
    });
  });
}
