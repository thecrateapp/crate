import { expect, test } from "@playwright/test";
for (const width of [1440, 768, 390]) {
  test(`New Releases specimen ${width}: views, controls and real handlers`, async ({
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
    await page.goto("/admin-new-releases-demo.html");
    const root = page.locator(
      'section[aria-label="Página real de New Releases"]',
    );
    await expect(
      root.getByRole("heading", { name: "New Releases", exact: true }),
    ).toBeVisible();
    await page.waitForFunction(() => document.fonts.status === "loaded");
    expect(
      await root
        .getByRole("heading", { level: 1 })
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("Bricolage Grotesque");
    expect(
      await root
        .getByRole("textbox", { name: "Search releases" })
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("IBM Plex Sans");
    expect(
      await root
        .getByText("Release type", { exact: true })
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("JetBrains");
    expect(
      await root
        .locator("svg:not([data-admin-ux])")
        .evaluateAll(
          (nodes) =>
            nodes.filter((el) => !el.closest('[role="combobox"]')).length,
        ),
    ).toBe(0);
    for (const field of await root.locator(".crate-form-field").all())
      expect(
        await field.evaluate((el) => {
          const [label, control] = Array.from(el.children);
          return (
            control!.getBoundingClientRect().top -
            label!.getBoundingClientRect().bottom
          );
        }),
      ).toBe(8);
    for (const control of await root.locator("button,input").all())
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const select = root.getByRole("combobox", { name: "All types" });
    await select.press("ArrowDown");
    const unknown = page.getByRole("option", { name: /Unknown type/ });
    await expect(unknown).toBeVisible();
    expect(
      await unknown.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const top = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        return !!top && (el === top || el.contains(top));
      }),
    ).toBe(true);
    await unknown.click();
    await expect(
      root.getByText("Puerto sin fecha", { exact: true }),
    ).toBeVisible();
    await expect(
      root.getByRole("link", { name: "Luz de octubre", exact: true }),
    ).toHaveCount(0);
    await select.click();
    await page.getByRole("option", { name: "All types", exact: true }).click();
    const search = root.getByRole("textbox", { name: "Search releases" });
    await search.fill("  LUZ  ");
    await expect(
      root.getByRole("link", { name: "Luz de octubre", exact: true }),
    ).toBeVisible();
    await expect(root.getByText("Mañana", { exact: true })).toHaveCount(0);
    await search.fill("");
    await root
      .getByRole("button", { name: "Grid", exact: true })
      .press("Enter");
    await expect(
      root.getByRole("button", { name: "Grid", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      root.locator('[data-admin-ux="releases-grid-dismiss"]'),
    ).toHaveCount(3);
    await root.getByRole("button", { name: "Timeline", exact: true }).click();
    await root
      .getByRole("button", { name: "Check now", exact: true })
      .press("Enter");
    const busy = root.getByRole("button", { name: "Checking…", exact: true });
    await expect(busy).toHaveAttribute("aria-busy", "true");
    await expect(busy).toBeDisabled();
    const advance = page.getByRole("button", {
      name: "Completar siguiente paso de muestra",
      exact: true,
    });
    await advance.click();
    await expect(busy).toBeDisabled();
    await advance.click();
    await expect(
      root.getByRole("button", { name: "Check now", exact: true }),
    ).toBeEnabled();
    await root
      .getByRole("button", { name: "Download", exact: true })
      .last()
      .click();
    await advance.click();
    await expect(
      root.getByRole("button", { name: "Download", exact: true }),
    ).toHaveCount(1);
    await root
      .getByRole("button", { name: "Downloading", exact: true })
      .click();
    await expect(
      root.locator('[data-admin-ux="releases-download-loading"]'),
    ).toHaveCount(2);
    await root
      .getByRole("button", { name: "Needs action", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Enviar SSE no válido", exact: true })
      .click();
    await expect(root.getByText("Mañana", { exact: true })).toBeVisible();
    await page
      .getByRole("button", {
        name: "Enviar actualización SSE de muestra",
        exact: true,
      })
      .click();
    await root.getByRole("button", { name: "Downloaded", exact: true }).click();
    await expect(
      root.getByRole("link", { name: "Luz de octubre", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("radio", { name: "Solo lectura", exact: true })
      .click();
    await expect(
      root.getByRole("button", { name: "Check now", exact: true }),
    ).toHaveCount(0);
    await expect(
      root.getByRole("button", { name: "Dismiss release", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("radio", { name: "Adquirir", exact: true }).click();
    await root
      .getByRole("button", { name: "Needs action", exact: true })
      .click();
    await expect(
      root.getByRole("button", { name: "Download", exact: true }),
    ).toHaveCount(1);
    await expect(
      root.getByRole("button", { name: "Dismiss release", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("radio", { name: "Curar", exact: true }).click();
    await page
      .getByRole("checkbox", { name: "Fallar el siguiente envío", exact: true })
      .check();
    await root.getByRole("button", { name: "Download", exact: true }).click();
    await advance.click();
    await expect(
      page.getByText("Download failed", { exact: true }),
    ).toBeVisible();
    await expect(
      root.getByRole("button", { name: "Download", exact: true }),
    ).toHaveCount(1);
    await root
      .getByRole("button", { name: "Dismiss release", exact: true })
      .first()
      .click();
    await advance.click();
    await expect(root.getByText("Mañana", { exact: true })).toHaveCount(0);
    await page.getByRole("radio", { name: "Cargando", exact: true }).click();
    await expect(
      root.getByRole("status", { name: "Loading releases", exact: true }),
    ).toBeVisible();
    await advance.click();
    await expect(
      root.getByRole("status", { name: "Loading releases", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("radio", { name: "Error", exact: true }).click();
    await expect(
      root.getByText("Lectura de muestra no disponible", { exact: true }),
    ).toBeVisible();
    await page.getByRole("radio", { name: "Vacío", exact: true }).click();
    await expect(
      root.getByText("No releases match the current radar", { exact: true }),
    ).toBeVisible();
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
  });
}
test("keeps persistent 1AJ and previously published checkpoints", async ({
  page,
}) => {
  await page.goto("/#lanzamientos-admin");
  const section = page.getByRole("region", {
    name: "Checkpoint 1AJ, New Releases de Admin",
    exact: true,
  });
  await expect(section).toBeVisible();
  const frame = page.frameLocator(
    'iframe[title="New Releases real con datos de muestra"]',
  );
  await expect(
    frame.getByRole("heading", { name: "New Releases", exact: true }),
  ).toBeVisible();
  await expect(page.locator("footer")).toContainText("1AI publicado");
  await expect(page.locator("footer")).toContainText("1AJ publicado");
  await expect(
    page.locator('iframe[src="./admin-discovery-demo.html"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('iframe[src="./admin-bandcamp-demo.html"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('iframe[src="./admin-timeline-demo.html"]'),
  ).toHaveCount(0);
});
