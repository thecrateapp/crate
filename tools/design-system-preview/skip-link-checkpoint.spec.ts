import { expect, test } from "@playwright/test";
for (const width of [1440, 390]) {
  test.describe(`skip navigation ${width}`, () => {
    test.use({
      viewport: { width, height: 700 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    for (const app of ["admin", "listen"]) {
      test(`${app} skip link at ${width}px moves keyboard focus without changing the URL`, async ({
        page,
      }, info) => {
        const errors: string[] = [];
        const requests: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => {
          if (request.url().includes("/api/")) requests.push(request.url());
        });
        await page.goto(
          `/skip-link-demo.html?app=${app}&locale=es&tab=albums#origen`,
        );
        await page.evaluate(() => document.fonts.ready);
        const link = page.getByRole("link", {
          name:
            app === "admin"
              ? "Skip to main content"
              : "Saltar al contenido principal",
        });
        await expect(link).not.toBeInViewport();
        const before = page.url();
        await page.keyboard.press("Tab");
        await expect(link).toBeFocused();
        await expect(link).toBeInViewport();
        await expect(link).toHaveCSS("outline-style", "solid");
        await expect(link).toHaveCSS("outline-width", "2px");
        const box = (await link.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(16);
        expect(box.y).toBeGreaterThanOrEqual(16);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        await page.screenshot({
          path: info.outputPath(`skip-link-${app}-${width}.png`),
        });
        await page.keyboard.press("Enter");
        await expect(page.getByRole("main")).toBeFocused();
        expect(page.url()).toBe(before);
        await expect(link).not.toBeInViewport();
        await page.keyboard.press("Tab");
        await expect(
          page.getByRole("button", { name: "Abrir muestra" }),
        ).toBeFocused();
        await link.focus();
        await link.click();
        await expect(page.getByRole("main")).toBeFocused();
        expect(page.url()).toBe(before);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(requests).toEqual([]);
        expect(errors).toEqual([]);
      });
    }
  });
}

test("skip navigation remains visible in forced colours and reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto("/skip-link-demo.html?app=listen&locale=de");
  const link = page.getByRole("link", { name: "Zum Hauptinhalt springen" });
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  await expect(link).toBeInViewport();
  await expect(link).toHaveCSS("border-top-style", "solid");
  await expect(link).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
});

test("the persistent 1U specimen exposes both real skip controls", async ({
  page,
}, info) => {
  await page.goto("/?tab=albums&listenTab=history#saltar-contenido");
  const section = page.getByRole("region", {
    name: "Checkpoint 1U, Saltar al contenido",
  });
  await expect(section).toBeVisible();
  for (const app of ["Admin", "Listen"]) {
    const frame = page.frameLocator(
      `iframe[title="Ejemplo de teclado de ${app}"]`,
    );
    const link = frame.locator(".crate-skip-link");
    const figure = section.locator("figure").filter({
      has: page.getByRole("button", { name: `Mostrar enlace de ${app}` }),
    });
    const label = (await figure
      .locator("figcaption > :first-child")
      .boundingBox())!;
    const control = (await figure.getByRole("button").boundingBox())!;
    expect(control.y - label.y - label.height).toBeCloseTo(8, 0);
    await section
      .getByRole("button", { name: `Mostrar enlace de ${app}` })
      .click();
    await expect(link).toBeFocused();
    await expect(link).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(frame.getByRole("main")).toBeFocused();
  }
  await section.screenshot({ path: info.outputPath("checkpoint-1u.png") });
});
