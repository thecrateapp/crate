import { expect, test } from "@playwright/test";
for (const width of [1440, 768, 390])
  test(`Roles specimen ${width}: read-only typography, data and pending read`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 });
    const unexpected: string[] = [],
      errors: string[] = [];
    page.on("request", (request) => {
      const u = new URL(request.url());
      if (
        u.pathname.startsWith("/api/") ||
        (!["127.0.0.1", "localhost"].includes(u.hostname) &&
          u.protocol !== "data:")
      )
        unexpected.push(request.url());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/admin-roles-demo.html");
    const root = page.locator('section[aria-label="Página real de Roles"]');
    await expect(root.getByText("Librarian", { exact: true })).toBeVisible();
    await page.waitForFunction(() => document.fonts.status === "loaded");
    await expect(root.locator("svg")).toHaveCount(0);
    await expect(root.getByRole("button")).toHaveCount(0);
    await expect(root.getByRole("textbox")).toHaveCount(0);
    await expect(root.getByRole("link")).toHaveCount(0);
    expect(
      await root
        .getByRole("heading", { level: 1 })
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("Bricolage Grotesque");
    expect(
      await root
        .getByText("librarian", { exact: true })
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("JetBrains");
    expect(
      await root
        .getByText(
          "System role presets mapped to explicit backend capabilities.",
          { exact: true },
        )
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("IBM Plex Sans");
    await expect(
      root.getByText("3 capabilities", { exact: true }),
    ).toBeVisible();
    await expect(
      root.getByText("2 capabilities", { exact: true }),
    ).toBeVisible();
    await expect(root.getByText("library.view", { exact: true })).toHaveCount(
      3,
    );
    for (const field of await root.locator(".crate-form-field").all())
      expect(
        await field.evaluate((el) => {
          const [label, value] = Array.from(el.children);
          return (
            value!.getBoundingClientRect().top -
            label!.getBoundingClientRect().bottom
          );
        }),
      ).toBe(8);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const loading = page.getByRole("radio", { name: "Cargando", exact: true });
    await loading.press("Enter");
    await expect(
      root.getByRole("status", { name: "Loading roles", exact: true }),
    ).toBeVisible();
    const finish = page.getByRole("button", {
      name: "Completar lectura de muestra",
      exact: true,
    });
    await expect(finish).toBeEnabled();
    await finish.click();
    await expect(root.getByText("Librarian", { exact: true })).toBeVisible();
    await expect(
      root.getByRole("status", { name: "Loading roles", exact: true }),
    ).toHaveCount(0);
    for (const label of ["Vacío", "Sin payload"]) {
      await page.getByRole("radio", { name: label, exact: true }).click();
      await expect(root.getByText("Librarian", { exact: true })).toHaveCount(0);
      await expect(
        root.getByText("Capability catalog", { exact: true }),
      ).toBeVisible();
      await expect(
        root.getByText("3 capabilities", { exact: true }),
      ).toHaveCount(0);
    }
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
  });
test("keeps persistent1AL, corrected1AK copy and earlier checkpoints", async ({
  page,
}) => {
  await page.goto("/#roles-admin");
  await expect(
    page.getByRole("region", {
      name: "Checkpoint 1AL, Roles de Admin",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[title="Roles real con datos de muestra"]')
      .getByRole("heading", { name: "Roles & Permissions", exact: true }),
  ).toBeVisible();
  await expect(page.locator("footer")).toContainText("1AK publicado");
  await expect(page.locator("footer")).toContainText("1AL publicado");
  await expect(
    page.getByRole("region", {
      name: "Checkpoint 1AK, Global Catalog de Admin",
      exact: true,
    }),
  ).toContainText("bloqueo durante el envío y lecturas posteriores asíncronas");
  await expect(
    page.locator('iframe[src="./admin-global-catalog-demo.html"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('iframe[src="./admin-timeline-demo.html"]'),
  ).toHaveCount(0);
});
