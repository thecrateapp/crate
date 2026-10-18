import { expect, test } from "@playwright/test";
test("1AA retains earlier checkpoints and embeds the actual Analysis page", async ({
  page,
}) => {
  await page.goto("/?tab=albums&listenTab=history#analisis-admin");
  const section = page.getByRole("region", {
    name: "Checkpoint 1AA, Analysis de Admin",
  });
  await expect(section).toBeVisible({ timeout: 5000 });
  const frame = section.frameLocator("iframe");
  await expect(
    frame.getByRole("heading", { name: "Analysis", exact: true }),
  ).toBeVisible();
  for (const id of [
    "operaciones-admin",
    "superficies-admin",
    "controles-admin",
    "navegacion-admin",
    "iconos-admin",
    "pistas",
    "estados",
    "pestanas",
  ])
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  await expect(page.locator("footer")).toContainText("1Z publicado");
  await expect(page.locator("footer")).toContainText("1AA en revisión");
});
for (const width of [1440, 768, 390]) {
  test.describe(`Analysis real preview ${width}`, () => {
    test.use({
      viewport: { width, height: 1100 },
      isMobile: width === 390,
      hasTouch: width === 390,
    });
    test("keeps named actions, progress, summaries, spacing and isolated states", async ({
      page,
    }) => {
      const errors: string[] = [],
        network: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.url().includes("/api/")) network.push(request.url());
      });
      await page.goto("/admin-analysis-demo.html");
      const real = page.getByRole("region", { name: "Página real de Admin" });
      await expect(
        real.getByRole("heading", { name: "Analysis", exact: true }),
      ).toBeVisible();
      await expect(real.locator("svg")).toHaveCount(0);
      await expect(
        real.getByRole("heading", { name: "Operator notes", exact: true }),
      ).toHaveCount(0);
      const recentPanel = real
        .getByRole("heading", { name: "Recent outputs", exact: true })
        .locator("xpath=ancestor::section[1]");
      const coveragePanel = real
        .getByRole("heading", { name: "Pipeline coverage", exact: true })
        .locator("xpath=ancestor::section[1]");
      expect((await recentPanel.boundingBox())!.width).toBe(
        (await coveragePanel.boundingBox())!.width,
      );

      await expect(real.getByText("Marea", { exact: true })).toBeVisible();
      await expect(real.getByText("Horizonte", { exact: true })).toBeVisible();
      const fingerprint = real.getByRole("article", {
        name: "Last audio fingerprint",
        exact: true,
      });
      await expect(
        fingerprint.getByText("Bruma", { exact: true }),
      ).toBeVisible();
      await expect(
        fingerprint.getByText("Chromaprint", { exact: true }),
      ).toBeVisible();
      await expect(recentPanel.getByRole("article")).toHaveCount(3);

      const summaries = real
        .getByRole("heading", { name: "Analysis", exact: true })
        .locator("xpath=ancestor::section[1]")
        .locator("span");
      const geometry = await summaries.evaluateAll((nodes) =>
        nodes.map((node) => {
          const css = getComputedStyle(node);
          return [
            node.getBoundingClientRect().height,
            css.fontSize,
            css.lineHeight,
            css.fontFamily,
            css.borderRadius,
            css.paddingBlock,
            css.paddingInline,
          ];
        }),
      );
      expect(geometry).toHaveLength(9);
      expect(new Set(geometry.map((entry) => JSON.stringify(entry))).size).toBe(
        1,
      );
      const pairs = await real
        .locator(".crate-form-field")
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            gap:
              node.children[1]!.getBoundingClientRect().top -
              node.children[0]!.getBoundingClientRect().bottom,
            childMargin: getComputedStyle(node.children[1]!).marginTop,
          })),
        );
      expect(pairs).toHaveLength(27);
      for (const pair of pairs)
        expect(pair).toEqual({ gap: 8, childMargin: "0px" });
      const actions = [
        "Refresh",
        "Backfill fingerprints",
        "Recompute popularity",
        "Recompute bliss",
        "Re-analyze all",
        "Sync lyrics",
        "Write metadata",
        "Rehydrate",
        "Export index",
      ];
      for (const name of actions) {
        const action = real.getByRole("button", { name, exact: true });
        const box = await action.boundingBox();
        expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
      }
      const sync = real.getByRole("button", {
        name: "Sync lyrics",
        exact: true,
      });
      await sync.focus();
      await sync.press("Space");
      await expect(sync).toBeDisabled();
      await expect(sync).toHaveAttribute("aria-busy", "true");
      await expect(sync.locator("svg")).toHaveAttribute("aria-hidden", "true");
      await expect(
        page.getByRole("status", { name: "Última acción de muestra" }),
      ).toContainText("/api/manage/sync-lyrics");
      await page
        .getByRole("button", {
          name: "Completar acción de muestra",
          exact: true,
        })
        .click();
      await expect(sync).toBeEnabled();
      await expect(sync.locator("svg")).toHaveCount(0);
      await expect(real).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.getByRole("radio", { name: "Cargando", exact: true }).click();
      await expect(
        real.getByRole("status", { name: "Loading analysis status" }),
      ).toHaveAttribute("aria-busy", "true");
      await page.getByRole("radio", { name: "Vacío", exact: true }).click();
      await expect(
        real.getByText("0% audio covered", { exact: true }),
      ).toBeVisible();
      await expect(
        real.getByText("No recent output recorded yet.", { exact: true }),
      ).toHaveCount(3);
      await page
        .getByRole("radio", { name: "PCM fallback", exact: true })
        .click();
      await expect(real.getByText("PCM fallback", { exact: true })).toHaveCount(
        3,
      );
      await page
        .getByRole("radio", { name: "Sin estado", exact: true })
        .click();
      await expect(real.getByRole("alert")).toContainText(
        "No analysis status available",
      );
      await page
        .getByRole("radio", { name: "Sin servicio", exact: true })
        .click();
      await expect(real.getByRole("alert")).toContainText(
        "Sample analysis unavailable",
      );
      await real.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(
        real.getByRole("heading", { name: "Analysis", exact: true }),
      ).toBeVisible();
      expect(errors).toEqual([]);
      expect(network).toEqual([]);
    });
  });
}
test("isolates delayed action refreshes from later sample states", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/admin-analysis-demo.html");
  const real = page.getByRole("region", { name: "Página real de Admin" });
  await real.getByRole("button", { name: "Sync lyrics", exact: true }).click();
  await page
    .getByRole("button", { name: "Completar acción de muestra", exact: true })
    .click();
  await expect(
    real.getByRole("button", { name: "Sync lyrics", exact: true }),
  ).toBeEnabled();
  await page.getByRole("radio", { name: "Sin servicio", exact: true }).click();
  await page.clock.runFor(801);
  await expect(real.getByRole("alert")).toContainText(
    "Sample analysis unavailable",
  );
  await real.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    real.getByRole("heading", { name: "Analysis", exact: true }),
  ).toBeVisible();
});
