import { expect, test, type Locator } from "@playwright/test";
async function target44(target: Locator) {
  await expect
    .poll(async () => {
      const box = await target.boundingBox();
      return box ? Math.min(box.width, box.height) : 0;
    })
    .toBeGreaterThanOrEqual(44);
}
for (const width of [1440, 768, 390]) {
  test.describe(`Admin reusable controls ${width}`, () => {
    test.use({
      viewport: { width, height: 1100 },
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    test("1X keeps text results, UX glyphs, keyboard, loading and shared selection", async ({
      page,
    }, info) => {
      const errors: string[] = [],
        requests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.url().includes("/api/")) requests.push(request.url());
      });
      await page.addInitScript(() =>
        localStorage.setItem(
          "search-recents:v1",
          JSON.stringify(["Costa reciente"]),
        ),
      );
      await page.goto("/admin-controls-demo.html");
      const input = page.getByRole("textbox", { name: "Search library" });
      await input.focus();
      const recent = page.getByRole("button", {
        name: "Costa reciente",
        exact: true,
      });
      await expect(recent).toBeVisible();
      await expect(recent.locator("svg")).toHaveCount(0);
      await target44(recent);
      await input.fill("costa");
      const artist = page.getByRole("button", {
        name: /Costa Norte Artist artist/,
      });
      await expect(artist).toBeVisible();
      await expect(artist.locator("svg")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /Marea Costa Norte/ }).locator("svg"),
      ).toHaveCount(0);
      const trackRow = page.getByRole("button", { name: /Marea Costa Norte/ });
      const inFront = await trackRow.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return [0.1, 0.5, 0.9].every((x) =>
          [0.25, 0.5, 0.75].every((y) =>
            element.contains(
              document.elementFromPoint(
                box.x + box.width * x,
                box.y + box.height * y,
              ),
            ),
          ),
        );
      });
      expect(
        inFront,
        "search suggestions must be above the AI action beneath them",
      ).toBe(true);
      await input.press("Tab");
      await expect(artist).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(input).toBeFocused();
      await input.press("Tab");
      await artist.press("Escape");
      await expect(input).toBeFocused();
      await expect(artist).toHaveCount(0);
      await page
        .getByRole("checkbox", { name: "Servicio de IA disponible" })
        .focus();
      await input.focus();
      await expect(artist).toBeVisible();
      await input.press("Tab");
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: /Luz de octubre Costa Norte album/ }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(trackRow).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("checkbox", { name: "Servicio de IA disponible" }),
      ).toBeFocused();
      await expect(artist).toHaveCount(0);
      await input.focus();
      await expect(artist).toBeVisible();
      await input.press("ArrowDown");
      await input.press("Enter");
      await expect(page.getByLabel("Destino de muestra")).toHaveText(
        "/artists/costa-norte",
      );
      expect(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem("search-recents:v1")!),
        ),
      ).toContain("costa");
      await input.fill("vacio");
      await expect(
        page.getByText("No library matches", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("No library matches", { exact: true }).locator("svg"),
      ).toHaveCount(0);
      await input.fill("espera");
      await expect(input).toHaveAttribute("aria-busy", "true");
      await expect(
        page.locator('[data-admin-ux="search-loading"]'),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Completar carga de búsqueda" })
        .click();
      await expect(input).not.toHaveAttribute("aria-busy", "true");
      const clear = page.getByRole("button", { name: "Clear search" });
      await target44(clear);
      await expect(clear.locator("svg")).toHaveCount(1);
      await clear.click();
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("");
      await input.press("Escape");
      await input.fill("costa");
      await trackRow.click();
      await expect(page.getByLabel("Destino de muestra")).toHaveText(
        "/artists/costa-norte/luz-de-octubre",
      );
      const ai = page.getByRole("button", { name: "Investigar con IA" });
      await expect(ai).toBeVisible();
      await target44(ai);
      await expect(ai.locator('svg[data-admin-ux="ai-bot"]')).toHaveCount(1);
      const glyphBox = await ai
        .locator('svg[data-admin-ux="ai-bot"]')
        .boundingBox();
      expect(glyphBox!.width).toBe(20);
      expect(glyphBox!.height).toBe(20);
      await expect(ai).toHaveCSS("height", "44px");
      await expect(ai.locator('svg[data-admin-ux="ai-bot"]')).toHaveCSS(
        "width",
        "16px",
      );
      await ai.click();
      await expect(ai).toBeDisabled();
      await expect(ai).toHaveAttribute("aria-busy", "true");
      await expect(ai.locator("svg")).toHaveCount(1);
      await page
        .getByRole("button", { name: "Terminar muestra de IA" })
        .click();
      await expect(ai).toBeEnabled();
      await expect(ai.locator('svg[data-admin-ux="ai-bot"]')).toHaveCount(1);
      await page
        .getByRole("checkbox", { name: "Servicio de IA disponible" })
        .uncheck();
      await expect(ai).toHaveCount(0);
      await page
        .getByRole("checkbox", { name: "Servicio de IA disponible" })
        .check();
      await expect(ai).toBeVisible();
      const select = page.getByRole("combobox", { name: "Fuente de muestra" });
      await target44(select);
      await expect(select.locator("svg")).toHaveCount(1);
      const labelBox = await page
        .getByText("Fuente de muestra", { exact: true })
        .boundingBox();
      const selectBox = await select.boundingBox();
      expect(selectBox!.y - labelBox!.y - labelBox!.height).toBe(8);
      await select.focus();
      await select.press("Space");
      const options = page.getByRole("listbox");
      const selected = page.getByRole("option", {
        name: "Toda la biblioteca",
        exact: true,
      });
      await expect(selected).toBeFocused();
      const menuBox = await options.boundingBox();
      const optionBox = await selected.boundingBox();
      expect(optionBox!.x + optionBox!.width).toBeLessThanOrEqual(
        menuBox!.x + menuBox!.width,
      );
      await page.keyboard.press("ArrowDown");
      await expect(
        page.getByRole("option", { name: "Solo local", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByLabel("Fuente seleccionada")).toHaveText("local");
      await expect(select).toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
      expect(requests).toEqual([]);
      await info.attach("checkpoint-1x", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    });
  });
}
test("1X persists beside the published navigation checkpoint", async ({
  page,
}) => {
  await page.goto("/#controles-admin");
  await expect(
    page.getByRole("region", { name: "Checkpoint 1X, Controles de Admin" }),
  ).toBeVisible();
  await expect(
    page
      .frameLocator(
        'iframe[title="Controles reales de Admin con datos de muestra"]',
      )
      .getByRole("heading", { name: "Controles de Admin" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Checkpoint 1W, Navegación de Admin por texto",
    }),
  ).toContainText("Publicado");
});
