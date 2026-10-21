import { expect, test } from "@playwright/test";
for (const width of [1440, 768, 390])
  test(`Global Catalog specimen ${width}: words, views and enqueue lifecycle`, async ({
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
    await page.goto("/admin-global-catalog-demo.html");
    const root = page.locator(
      'section[aria-label="Página real de Global Catalog"]',
    );
    await expect(root.getByText("Global ready", { exact: true })).toBeVisible();
    await page.waitForFunction(() => document.fonts.status === "loaded");
    expect(
      await root
        .getByRole("heading", { level: 1 })
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("Bricolage Grotesque");
    expect(
      await root
        .getByText("Artists", { exact: true })
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("JetBrains");
    expect(
      await root
        .getByRole("button", { name: "Refresh", exact: true })
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("IBM Plex Sans");
    expect(
      await root
        .getByText("sample-run-20261018", { exact: true })
        .evaluate((el) => getComputedStyle(el).fontFamily),
    ).toContain("JetBrains");
    await expect(root.locator("svg:not([data-admin-ux])")).toHaveCount(0);
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
    for (const button of await root.getByRole("button").all())
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await root
      .getByRole("button", { name: "Runs", exact: true })
      .press("Enter");
    await expect(
      root.getByRole("button", { name: "Runs", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      root.getByText("sample-run-older", { exact: true }),
    ).toBeVisible();
    await expect(
      root.getByText("Sample peer unavailable", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await root.getByRole("button", { name: "Duplicates", exact: true }).click();
    await expect(
      root.getByText("sample-peer-2", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("checkbox", {
        name: "Permitir gestión de muestra",
        exact: true,
      })
      .uncheck();
    await expect(
      root.getByRole("button", { name: "Reconcile", exact: true }),
    ).toBeDisabled();
    await expect(
      root.getByRole("button", { name: "Full rebuild", exact: true }),
    ).toBeDisabled();
    await expect(
      root.getByRole("button", { name: "Refresh", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("checkbox", {
        name: "Permitir gestión de muestra",
        exact: true,
      })
      .check();
    const advance = page.getByRole("button", {
      name: "Completar siguiente paso de muestra",
      exact: true,
    });
    for (const name of ["Reconcile", "Full rebuild"]) {
      const selected = root.getByRole("button", { name, exact: true });
      await selected.press("Enter");
      await expect(selected).toHaveAttribute("aria-busy", "true");
      await expect(
        root.getByRole("button", { name: "Reconcile", exact: true }),
      ).toBeDisabled();
      await expect(
        root.getByRole("button", { name: "Full rebuild", exact: true }),
      ).toBeDisabled();
      await advance.click();
      await expect(selected).toBeEnabled();
      await expect(selected).toHaveAttribute("aria-busy", "false");
      await expect(advance).toBeEnabled(); // reads remain asynchronous after enqueue
      await advance.click();
      await expect(advance).toBeDisabled();
      await expect(
        root.getByRole("button", { name: "Duplicates", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    }
    await page
      .getByRole("checkbox", { name: "Fallar el siguiente envío", exact: true })
      .check();
    await root.getByRole("button", { name: "Reconcile", exact: true }).click();
    await advance.click();
    await expect(
      page.getByText("Failed to queue reconciliation", { exact: true }),
    ).toBeVisible();
    await expect(
      root.getByRole("button", { name: "Full rebuild", exact: true }),
    ).toBeEnabled();
    for (const [label, word, tone] of [
      ["Degradado", "Global degraded", "warn"],
      ["Actualizando", "Global refreshing", "off"],
      ["Fallback local", "Local fallback", "off"],
    ]) {
      await page.getByRole("radio", { name: label!, exact: true }).click();
      await expect(
        root.locator(`[data-tone="${tone}"]`).getByText(word!, { exact: true }),
      ).toBeVisible();
    }
    await page.getByRole("radio", { name: "Cargando", exact: true }).click();
    await expect(
      root.getByRole("button", { name: "Refresh", exact: true }),
    ).toBeDisabled();
    await advance.click();
    await expect(
      root.getByText("Local fallback", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("radio", { name: "Error de lectura", exact: true })
      .click();
    await expect(
      root.getByText("Catalog serving status is unavailable.", { exact: true }),
    ).toBeVisible();
    await expect(root.getByText("0", { exact: true })).toHaveCount(4);
    await page.getByRole("radio", { name: "Vacío", exact: true }).click();
    await expect(
      root.getByText("No reconciliation runs yet.", { exact: true }),
    ).toBeVisible();
    await root.getByRole("button", { name: "Runs", exact: true }).click();
    await expect(
      root.getByText("No runs found.", { exact: true }),
    ).toBeVisible();
    await root.getByRole("button", { name: "Duplicates", exact: true }).click();
    await expect(
      root.getByText(
        "No duplicate candidates above the confidence threshold.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
  });
test("keeps persistent1AK and the approved previous checkpoints", async ({
  page,
}) => {
  await page.goto("/#catalogo-global-admin");
  await expect(
    page.getByRole("region", {
      name: "Checkpoint 1AK, Global Catalog de Admin",
      exact: true,
    }),
  ).toBeVisible();
  const frame = page.frameLocator(
    'iframe[title="Global Catalog real con datos de muestra"]',
  );
  await expect(
    frame.getByRole("heading", { name: "Global Catalog", exact: true }),
  ).toBeVisible();
  await expect(page.locator("footer")).toContainText("1AJ publicado");
  await expect(page.locator("footer")).toContainText("1AK publicado");
  await expect(
    page.locator('iframe[src="./admin-new-releases-demo.html"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('iframe[src="./admin-discovery-demo.html"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('iframe[src="./admin-timeline-demo.html"]'),
  ).toHaveCount(0);
});
