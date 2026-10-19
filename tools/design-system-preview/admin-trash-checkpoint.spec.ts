import { expect, test } from "@playwright/test";

for (const width of [1440, 768, 390]) {
  test.describe(`Library Trash ${width}`, () => {
    test.use({
      viewport: { width, height: 1100 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    test("keeps real text controls, confirmations and isolated task states", async ({
      page,
    }) => {
      const errors: string[] = [],
        network: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.url().includes("/api/")) network.push(request.url());
      });
      await page.goto("/admin-trash-demo.html");
      const real = page.getByRole("region", {
        name: "Página real de Admin",
        exact: true,
      });
      await expect(real.getByText("Marea", { exact: true })).toBeVisible();
      await expect(
        real.getByRole("heading", { name: "Library Trash" }),
      ).toHaveCSS("font-family", /Bricolage Grotesque/);
      await expect(
        real.getByRole("button", { name: "Refresh", exact: true }),
      ).toHaveCSS("font-family", /^Poppins/);
      await expect(
        real.locator(
          "svg:not(.lucide-loader-circle):not([data-admin-ux=header-refresh]):not([data-admin-ux=header-empty-trash])",
        ),
      ).toHaveCount(0);
      for (const control of await real.locator("button:visible").all()) {
        const box = (await control.boundingBox())!;
        expect(
          Number(Math.min(box.width, box.height).toFixed(2)),
        ).toBeGreaterThanOrEqual(44);
      }
      const field = page.locator(".crate-form-field");
      expect(
        await field.evaluate(
          (el) =>
            el.children[1]!.getBoundingClientRect().top -
            el.children[0]!.getBoundingClientRect().bottom,
        ),
      ).toBe(8);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await expect(real.locator("button button,button a")).toHaveCount(0);
      const remove = real
        .getByRole("button", { name: "Delete", exact: true })
        .first();
      await remove.focus();
      await page.keyboard.press("Space");
      const dialog = page.getByRole("alertdialog", {
        name: "Delete Quarantined Track",
      });
      await expect(dialog).toHaveAccessibleDescription(
        /Marea.*cannot be undone/,
      );
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(remove).toBeFocused();
      await real
        .getByRole("button", { name: "Restore", exact: true })
        .first()
        .click();
      await expect(
        real.getByRole("button", { name: "Restore", exact: true }).first(),
      ).toHaveAttribute("aria-busy", "true");
      await expect(
        page.getByRole("status", { name: "Última acción de muestra" }),
      ).toContainText("/quarantine/restore");
      await expect(
        page.getByRole("status", { name: "Última acción de muestra" }),
      ).toContainText("Costa Norte/Luz de octubre/01.flac");
      await page
        .getByRole("button", {
          name: "Completar tarea de muestra",
          exact: true,
        })
        .click();
      await expect(real.getByText("Marea", { exact: true })).toHaveCount(0);
      await page
        .getByLabel("La siguiente tarea fallará", { exact: true })
        .check();
      await real.getByRole("button", { name: "Restore", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Completar tarea de muestra",
          exact: true,
        })
        .click();
      await expect(
        page.getByText("Fallo de tarea de muestra", { exact: true }),
      ).toBeVisible();
      await expect(
        real.getByText("Noche larga", { exact: true }),
      ).toBeVisible();
      await expect(
        real.getByRole("button", { name: "Restore", exact: true }),
      ).toBeEnabled();
      await real
        .getByRole("button", { name: "Empty trash", exact: true })
        .click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Empty Trash", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: "Completar tarea de muestra",
          exact: true,
        })
        .click();
      await expect(
        real.getByText(".crate-trash is empty", { exact: true }),
      ).toBeVisible();
      await expect(
        real.getByRole("button", { name: "Empty trash", exact: true }),
      ).toBeDisabled();
      await page.getByRole("radio", { name: "Cargando", exact: true }).click();
      await expect(
        real.getByRole("button", { name: "Refresh", exact: true }),
      ).toBeDisabled();
      await expect(
        real.locator('[data-admin-ux="trash-list-loading"]'),
      ).toBeVisible();
      await page.getByRole("radio", { name: "Vacía", exact: true }).click();
      await expect(
        real.getByText(".crate-trash is empty", { exact: true }),
      ).toBeVisible();
      expect(errors).toEqual([]);
      expect(network).toEqual([]);
    });
  });
}
test("1AE embeds Trash beside published 1AD", async ({ page }) => {
  await page.goto("/#papelera-admin");
  const section = page.getByRole("region", {
    name: "Checkpoint 1AE, Library Trash de Admin",
  });
  await expect(
    section
      .frameLocator("iframe")
      .getByRole("heading", { name: "Library Trash", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#salud-admin")).toHaveCount(1);
  await expect(page.locator("footer")).toContainText("1AD publicado");
  await expect(page.locator("footer")).toContainText("1AE publicado");
});
