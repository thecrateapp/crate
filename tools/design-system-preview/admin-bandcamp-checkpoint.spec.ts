import { expect, test } from "@playwright/test";
for (const width of [1440, 768, 390]) {
  test.describe(`Bandcamp specimen ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test("keeps actual page keyboard actions, readings and isolated local destinations", async ({
      page,
    }) => {
      const errors: string[] = [],
        requests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/"))
          requests.push(request.url());
      });
      await page.goto("/admin-bandcamp-demo.html");
      const real = page.getByRole("region", {
        name: "Página real de Bandcamp",
        exact: true,
      });
      await expect(real.getByRole("heading", { level: 1 })).toHaveText(
        "Support layer for the collection",
      );
      await expect(
        real.getByText("Diego de muestra", { exact: true }),
      ).toBeVisible();
      await page.waitForFunction(() => document.fonts.status === "loaded");
      expect(
        await real
          .getByRole("heading", { level: 1 })
          .evaluate((element) => getComputedStyle(element).fontFamily),
      ).toContain("Bricolage Grotesque");
      const metric = real.locator(".crate-form-field").first();
      expect(
        await metric.evaluate((element) => {
          const [label, value] = Array.from(element.children);
          return (
            value!.getBoundingClientRect().top -
            label!.getBoundingClientRect().bottom
          );
        }),
      ).toBe(8);
      expect(
        await metric
          .locator(":scope > :first-child")
          .evaluate((element) => getComputedStyle(element).fontFamily),
      ).toContain("JetBrains");
      expect(
        await metric
          .locator(":scope > :last-child")
          .evaluate((element) => getComputedStyle(element).fontFamily),
      ).toContain("Bricolage Grotesque");
      expect(
        await page
          .locator("body")
          .evaluate((element) => getComputedStyle(element).fontFamily),
      ).toContain("Roboto");
      await expect(real.locator("svg:not([data-admin-ux])")).toHaveCount(0);
      for (const button of await real.getByRole("button").all())
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const overflow = await page.evaluate(() =>
        Array.from(document.querySelectorAll("body *"))
          .filter(
            (element) =>
              element.getBoundingClientRect().right > window.innerWidth + 1,
          )
          .map((element) => ({
            tag: element.tagName,
            classes: element.className,
            width: element.getBoundingClientRect().width,
            text: element.textContent?.slice(0, 70),
          })),
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        JSON.stringify(overflow),
      ).toBe(true);
      const sync = real.getByRole("button", {
        name: "Sync collection",
        exact: true,
      });
      const complete = page.getByRole("button", {
        name: "Completar acción o lectura de muestra",
        exact: true,
      });
      await sync.focus();
      await page.keyboard.press("Enter");
      await expect(sync).toBeDisabled();
      await expect(sync).toHaveAttribute("aria-busy", "true");
      await expect(
        real.locator('[data-admin-ux="bandcamp-sync-loading"]'),
      ).toBeVisible();
      await complete.focus();
      await page.keyboard.press("Enter");
      await expect(sync).toBeEnabled();
      await expect(
        page.getByText("Bandcamp sync queued (sample-bandcamp-task)", {
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole("checkbox", {
          name: "Fallar la siguiente acción",
          exact: true,
        })
        .check();
      await real
        .getByRole("button", { name: "Reject", exact: true })
        .first()
        .click();
      await complete.click();
      await expect(
        page.getByText("Fallo de acción de muestra", { exact: true }),
      ).toBeVisible();
      await expect(
        real.getByText("Costa Norte · Luz en Crate", { exact: true }),
      ).toBeVisible();
      const confirm = real
        .getByRole("button", { name: "Confirm", exact: true })
        .first();
      await confirm.focus();
      await page.keyboard.press("Space");
      await expect(
        real.locator('[data-admin-ux="bandcamp-confirm-loading"]'),
      ).toBeVisible();
      await complete.click();
      await expect(
        real.getByText("Costa Norte · Luz en Crate", { exact: true }),
      ).toHaveCount(0);
      await expect(
        real.getByRole("heading", { name: "Luz en Crate", exact: true }),
      ).toBeVisible();
      const target = real.getByRole("button").filter({
        has: page.getByRole("heading", {
          name: "Marea de muestra",
          exact: true,
        }),
      });
      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        target.click(),
      ]);
      await expect(
        popup.getByRole("heading", {
          name: "Destino externo de muestra",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        popup.getByText("https://bandcamp.example.test/album/luz-de-octubre", {
          exact: true,
        }),
      ).toBeVisible();
      await popup.close();
      await page
        .getByRole("radio", { name: "Comprobando", exact: true })
        .click();
      await expect(
        real.getByText("Checking connection...", { exact: true }),
      ).toBeVisible();
      await expect(sync).toBeDisabled();
      await complete.click();
      await expect(real.getByText("Connected", { exact: true })).toBeVisible();
      await page
        .getByRole("radio", { name: "Sin conexión", exact: true })
        .click();
      await expect(
        real.getByText("Not connected", { exact: true }),
      ).toBeVisible();
      await expect(sync).toBeDisabled();
      await expect(
        real.getByRole("button", { name: "Backfill URLs", exact: true }),
      ).toBeEnabled();
      await page.getByRole("radio", { name: "Vacío", exact: true }).click();
      await expect(
        real.getByText("No Bandcamp match candidates pending.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        real.getByText("No Bandcamp imports yet.", { exact: true }),
      ).toBeVisible();
      expect(errors).toEqual([]);
      expect(requests).toEqual([]);
    });
  });
}
