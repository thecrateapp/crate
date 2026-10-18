import { expect, test } from "@playwright/test";

for (const width of [1440, 768, 390]) {
  test.describe(`Contributions ${width}`, () => {
    test.use({ viewport: { width, height: 1100 } });
    test("keeps attribution, keyboard navigation and isolated read states", async ({
      page,
    }) => {
      const errors: string[] = [],
        traffic: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.url().includes("/api/")) traffic.push(request.url());
      });
      await page.goto("/admin-contributions-demo.html");
      const real = page.getByRole("region", {
        name: "Página real de Admin",
        exact: true,
      });
      const first = real.getByRole("link", {
        name: "Luz de octubre",
        exact: true,
      });
      await expect(first).toBeVisible();
      await expect(
        real.getByRole("heading", { name: "Contributions", exact: true }),
      ).toHaveCSS("font-family", /Bricolage Grotesque/);
      await expect(
        real.getByRole("button", { name: "Refresh", exact: true }),
      ).toHaveCSS("font-family", /^Poppins/);
      await expect(real.getByText("sample/ref-004", { exact: true })).toHaveCSS(
        "font-family",
        /JetBrains Mono/,
      );
      await expect(
        real.getByText("Lucía de muestra", { exact: true }),
      ).toBeVisible();
      await expect(
        real.getByText("curadora@example.test", { exact: true }),
      ).toBeVisible();
      await expect(
        real.getByText("Unknown user", { exact: true }),
      ).toBeVisible();
      await expect(
        real.getByRole("link", { name: "Mareas", exact: true }),
      ).toHaveCount(0);
      await expect(real.locator("svg")).toHaveCount(0);
      await expect(real.locator("button button,button a,a a")).toHaveCount(0);
      for (const control of await real.locator("button,a").all()) {
        const box = (await control.boundingBox())!;
        expect(
          Number(Math.min(box.width, box.height).toFixed(2)),
        ).toBeGreaterThanOrEqual(44);
      }
      const overflow = await page.evaluate(() =>
        [...document.querySelectorAll("main,main *")]
          .map((el) => ({
            tag: el.tagName,
            cls: el.className,
            right: el.getBoundingClientRect().right,
            width: el.getBoundingClientRect().width,
          }))
          .filter((el) => el.right > document.documentElement.clientWidth + 1)
          .slice(0, 20),
      );
      if (overflow.length) console.log(JSON.stringify(overflow));
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      const field = page.locator(".crate-form-field"),
        label = await field.locator(":scope > :first-child").boundingBox(),
        input = await field.locator(":scope > :last-child").boundingBox();
      expect(input!.y - label!.y - label!.height).toBe(8);
      const refresh = real.getByRole("button", {
        name: "Refresh",
        exact: true,
      });
      await refresh.focus();
      await page.keyboard.press("Enter");
      await expect(refresh).toBeDisabled();
      await expect(refresh).toHaveAttribute("aria-busy", "true");
      await expect(real.locator("svg[data-admin-ux]")).toHaveCount(2);
      await page
        .getByRole("button", {
          name: "Completar lectura de muestra",
          exact: true,
        })
        .click();
      await expect(refresh).toBeEnabled();
      await expect(real.locator("svg")).toHaveCount(0);
      await first.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/artists\/costa-norte\/luz-de-octubre$/);
      await expect(
        page.getByRole("heading", { name: "Destino de muestra" }),
      ).toBeVisible();
      await page
        .getByRole("link", {
          name: "Volver a Contributions de muestra",
          exact: true,
        })
        .click();
      await expect(first).toBeVisible();
      await page.getByRole("radio", { name: "Vacío", exact: true }).click();
      await expect(
        real.getByText("No contributions yet", { exact: true }),
      ).toBeVisible();
      await page.getByRole("radio", { name: "Cargando", exact: true }).click();
      await expect(
        real.getByText("Loading contributions...", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", {
          name: "Completar lectura de muestra",
          exact: true,
        })
        .click();
      await expect(first).toBeVisible();
      await page.getByRole("radio", { name: "Error", exact: true }).click();
      await expect(
        real.getByText("No contributions yet", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Lectura de muestra no disponible", { exact: true }),
      ).toBeVisible();
      expect(errors).toEqual([]);
      expect(traffic).toEqual([]);
    });
  });
}

test("1AF embeds Contributions beside published 1AE", async ({ page }) => {
  await page.goto("/#aportes-admin");
  const section = page.getByRole("region", {
    name: "Checkpoint 1AF, Contributions de Admin",
    exact: true,
  });
  await expect(
    section
      .frameLocator("iframe")
      .getByRole("heading", { name: "Contributions", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#papelera-admin")).toHaveCount(1);
  await expect(page.locator("footer")).toContainText("1AE publicado");
  await expect(page.locator("footer")).toContainText("1AF publicado");
});
