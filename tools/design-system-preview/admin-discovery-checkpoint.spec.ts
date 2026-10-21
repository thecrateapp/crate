import { expect, test } from "@playwright/test";
for (const width of [1440, 768, 390]) {
  test.describe(`Discovery specimen ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test("keeps real keyboard search, independent tasks and canonical sample destinations", async ({
      page,
    }) => {
      const errors: string[] = [],
        requests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.startsWith("/api/"))
          requests.push(request.url());
      });
      await page.goto("/admin-discovery-demo.html");
      const real = page.getByRole("region", {
        name: "Página real de Discovery",
        exact: true,
      });
      await expect(
        real.getByRole("heading", { name: "Discovery", exact: true }),
      ).toBeVisible();
      const search = real.getByRole("textbox", {
        name: "Search discovery",
        exact: true,
      });
      await expect(
        real.getByAltText("Costa Norte", { exact: true }),
      ).toBeVisible();
      await expect(
        real.getByAltText("Viento Sur", { exact: true }),
      ).toBeHidden();
      expect(
        await real
          .getByAltText("Costa Norte", { exact: true })
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      ).toBeGreaterThan(0);
      await expect(real.locator("svg:not([data-admin-ux])")).toHaveCount(0);
      await page.waitForFunction(() => document.fonts.status === "loaded");
      expect(
        await real
          .getByRole("heading", { level: 1 })
          .evaluate((el) => getComputedStyle(el).fontFamily),
      ).toContain("Bricolage Grotesque");
      expect(
        await real
          .locator(".crate-form-field")
          .first()
          .locator(":scope > :first-child")
          .evaluate((el) => getComputedStyle(el).fontFamily),
      ).toContain("JetBrains");
      expect(
        await page
          .locator("body")
          .evaluate((el) => getComputedStyle(el).fontFamily),
      ).toContain("IBM Plex Sans");
      for (const field of await real.locator(".crate-form-field").all())
        expect(
          await field.evaluate((el) => {
            const [label, component] = Array.from(el.children);
            return (
              component!.getBoundingClientRect().top -
              label!.getBoundingClientRect().bottom
            );
          }),
        ).toBe(8);
      for (const button of await real.getByRole("button").all())
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await search.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const overflow = await page.evaluate(() =>
        Array.from(document.querySelectorAll("body *"))
          .filter(
            (el) => el.getBoundingClientRect().right > window.innerWidth + 1,
          )
          .slice(0, 6)
          .map((el) => ({
            tag: el.tagName,
            classes: el.className,
            text: el.textContent?.slice(0, 40),
          })),
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        JSON.stringify(overflow),
      ).toBe(true);
      await search.fill(" MAR DE ");
      await expect(
        real.getByText("No detected releases available right now.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        real.getByRole("button", { name: "Open artist", exact: true }),
      ).toHaveCount(1);
      await search.fill("");
      await page.getByRole("radio", { name: "Parcial", exact: true }).click();
      const recompute = real.getByRole("button", {
        name: "Recompute gaps",
        exact: true,
      });
      await recompute.focus();
      await page.keyboard.press("Enter");
      const advance = page.getByRole("button", {
        name: "Completar siguiente paso de muestra",
        exact: true,
      });
      await expect(
        real.getByRole("button", { name: "Recomputing...", exact: true }),
      ).toBeDisabled();
      await advance.click();
      await expect(
        page.getByText("Completeness refresh queued", { exact: true }),
      ).toBeVisible();
      const check = real.getByRole("button", {
        name: "Check releases",
        exact: true,
      });
      await expect(check).toBeEnabled();
      await check.focus();
      await page.keyboard.press("Space");
      await expect(check).toBeDisabled();
      await advance.click();
      await expect(
        page.getByText("Completeness refreshed with 2 artists skipped", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(recompute).toBeEnabled();
      await expect(check).toBeDisabled();
      await advance.click();
      await expect(check).toBeEnabled();
      await expect(
        page.getByText("New release check queued", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("checkbox", {
          name: "Fallar el siguiente envío",
          exact: true,
        })
        .check();
      await check.click();
      await advance.click();
      await expect(
        page.getByText("Failed to queue release check", { exact: true }),
      ).toBeVisible();
      await real
        .getByRole("button", { name: "Acquire missing", exact: true })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Destino de muestra", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("/download?q=Costa%20Norte", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("link", {
          name: "Volver a Discovery de muestra",
          exact: true,
        })
        .click();
      await real
        .getByRole("button", { name: "Open full radar", exact: true })
        .click();
      await expect(
        page.getByText("/new-releases", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("link", {
          name: "Volver a Discovery de muestra",
          exact: true,
        })
        .click();
      await page.getByRole("radio", { name: "Cargando", exact: true }).click();
      await expect(
        real.locator('[data-admin-ux="discovery-loading"]'),
      ).toBeVisible();
      await advance.click();
      await expect(
        real.getByRole("heading", { name: "Discovery", exact: true }),
      ).toBeVisible();
      await page.getByRole("radio", { name: "Error", exact: true }).click();
      await expect(
        real.getByText("Failed to build discovery workspace", { exact: true }),
      ).toBeVisible();
      await page.getByRole("radio", { name: "Vacío", exact: true }).click();
      await expect(
        real.getByText(
          "No acquisition opportunities match the current filter.",
          { exact: true },
        ),
      ).toBeVisible();
      expect(errors).toEqual([]);
      expect(requests).toEqual([]);
    });
  });
}
test("keeps the real persistent checkpoint and earlier published specimens", async ({
  page,
}) => {
  await page.goto("/#discovery-admin");
  const section = page.getByRole("region", {
    name: "Checkpoint 1AI, Discovery de Admin",
    exact: true,
  });
  await expect(
    section.getByRole("heading", {
      name: "Descubrir, con contexto.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    section
      .frameLocator("iframe")
      .getByRole("heading", { name: "Discovery", exact: true }),
  ).toBeVisible();
  await expect(page.locator("footer")).toContainText("1AH publicado");
  await expect(page.locator("footer")).toContainText("1AI publicado");
  await expect(
    page.locator('iframe[src="./admin-bandcamp-demo.html"]'),
  ).toHaveCount(1);
  await expect(page.locator('iframe[src*="admin-timeline"]')).toHaveCount(0);
});
