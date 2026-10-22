import { expect, test } from "@playwright/test";

test("A1b operational surfaces use solid shared tokens", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) apiRequests.push(request.url());
  });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/review-admin-operations.html");
    const hero = page
      .getByTestId("ops-hero")
      .locator('[data-slot="admin-page-header-container"]');
    const tile = page
      .getByTestId("ops-stats")
      .locator("[data-sample-stat]")
      .first()
      .locator("div")
      .first();
    await expect(hero).toBeVisible();
    await expect(tile).toBeVisible();
    const queues = page.getByRole("region", { name: "Worker queue lanes" });
    await expect(queues.getByRole("listitem")).toHaveCount(5);
    const defaultFlow = queues.getByRole("group", {
      name: "default task flow",
    });
    expect(
      await defaultFlow.evaluate((lane) => lane.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(48);
    const governor = page.getByRole("region", { name: "Resource governor" });
    await expect(governor.getByRole("meter")).toHaveCount(5);
    await expect(governor).toContainText("ALLOWED · BACKGROUND WORK RUNS");
    await expect(
      queues.getByRole("listitem", { name: "maintenance queue" }),
    ).toContainText("metadata_enrichment");
    await expect(
      queues.getByRole("group", { name: "playback task flow" }),
    ).toContainText("playback_prepare");
    await expect(
      queues.getByRole("group", { name: "heavy task flow" }),
    ).toContainText("audio_analysis");
    const demoChip = queues.locator('[data-queue-task-id="queue-flow-demo"]');
    await expect(demoChip).toHaveAttribute("data-queue-state", "queued");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await demoChip.evaluate(
        (element) => getComputedStyle(element).transitionProperty,
      ),
    ).toBe("none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await demoChip.evaluate((element) => {
      (window as Window & { queueDemoChip?: Element }).queueDemoChip = element;
    });
    await page
      .getByRole("button", { name: "Advance sample task from queued" })
      .click();
    const runningChip = queues.locator(
      '[data-queue-task-id="queue-flow-demo"]',
    );
    await expect(runningChip).toHaveAttribute("data-queue-state", "running");
    await expect(runningChip).toHaveAttribute("style", /left: 36%/);
    expect(
      await runningChip.evaluate(
        (element) =>
          element ===
          (window as Window & { queueDemoChip?: Element }).queueDemoChip,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Advance sample task from running" })
      .click();
    await expect(demoChip).toHaveAttribute("data-queue-state", "done");
    await expect(demoChip).toHaveAttribute("style", /left: 86%/);
    const freshness = page.getByTestId("ops-freshness");
    await expect(freshness.getByText("Snapshot current")).toBeVisible();
    await expect(freshness.getByText("Live updates")).toBeVisible();
    await expect(freshness.getByText("Snapshot stale")).toBeVisible();
    await expect(freshness.getByText("Reconnecting")).toBeVisible();
    await expect(freshness.getByRole("alert")).toContainText(
      "Showing the last successful snapshot.",
    );
    await freshness.getByRole("button", { name: "Retry" }).click();
    await expect(hero.getByRole("status")).toContainText("Muestra actualizada");
    const appearance = async (surface: typeof hero) =>
      surface.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          boxShadow: style.boxShadow,
          backdropFilter: style.backdropFilter,
        };
      });
    expect(await appearance(hero)).toMatchObject({
      background: "rgba(0, 0, 0, 0)",
      boxShadow: "none",
      backdropFilter: "none",
    });
    const tileAppearance = await appearance(tile);
    expect(tileAppearance.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(tileAppearance.boxShadow).toContain("rgba(0, 0, 0, 0)");
    expect(tileAppearance.backdropFilter).toBe("none");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
  expect(apiRequests).toEqual([]);
});

for (const width of [1440, 768, 390])
  for (const view of ["logs", "stack"] as const) {
    test.describe(`Admin ${view} operations ${width}`, () => {
      test.use({
        viewport: { width, height: 1100 },
        isMobile: width === 390,
        hasTouch: width === 390,
      });
      test("1Z preserves operational text, functional glyphs and local sample actions", async ({
        page,
      }) => {
        const errors: string[] = [],
          requests: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => {
          if (request.url().includes("/api/")) requests.push(request.url());
        });
        await page.goto(`/admin-operations-demo.html?page=${view}`);
        const real = page.getByRole("region", { name: "Página real de Admin" });
        await expect(
          real.getByRole("heading", {
            level: 1,
            name: view === "logs" ? "Logs" : "Stack",
            exact: true,
          }),
        ).toBeVisible();
        const refresh = real.getByRole("button", {
          name: "Refresh",
          exact: true,
        });
        await expect(refresh.locator("svg")).toHaveAttribute(
          "data-admin-ux",
          "header-refresh",
        );
        if (view === "logs") {
          const pause = real.getByRole("button", { name: "Pause live" });
          await expect(pause.locator("svg")).toHaveCount(1);
          await pause.click();
          await expect(
            real.getByRole("button", { name: "Resume live" }),
          ).toBeVisible();
          await real.getByRole("button", { name: "Resume live" }).click();
          await real.getByRole("radio", { name: "Error", exact: true }).click();
          await expect(
            real.getByText("Sample sync waiting", { exact: true }),
          ).toBeHidden();
          await real.getByRole("radio", { name: "All levels" }).click();
          const input = real.getByRole("textbox", {
            name: "Search worker logs",
          });
          await input.fill("Costa Norte");
          await expect(
            real.getByText("Sample analysis needs attention", { exact: true }),
          ).toBeVisible();
          await expect(
            real.getByText("Sample library ready", { exact: true }),
          ).toBeHidden();
          await input.clear();
          await real.getByRole("combobox", { name: "All categories" }).click();
          await page.getByRole("option", { name: "sync", exact: true }).click();
          await expect(
            real.getByText("Sample sync waiting", { exact: true }),
          ).toBeVisible();
          await expect(
            real.getByText("Sample library ready", { exact: true }),
          ).toBeHidden();
        } else {
          await expect(real.getByRole("article")).toHaveCount(3);
          await real
            .getByRole("radio", { name: "Stopped", exact: true })
            .click();
          await expect(real.getByRole("article")).toHaveCount(1);
          await real.getByRole("radio", { name: "All", exact: true }).click();
          const input = real.getByRole("textbox", {
            name: "Search stack services",
          });
          await input.fill("8686");
          await expect(real.getByRole("article")).toHaveCount(1);
          await input.clear();
          const card = real.getByRole("article", {
            name: "Service worker",
            exact: true,
          });
          for (const label of ["Status", "Ports", "Public route"]) {
            const geometry = await card
              .getByText(label, { exact: true })
              .locator("..")
              .evaluate((node) => {
                const label = node.children[0]!.getBoundingClientRect(),
                  value = node.children[1]!.getBoundingClientRect();
                return {
                  gap: value.top - label.bottom,
                  recipe: node.classList.contains("crate-form-field"),
                };
              });
            expect(geometry).toEqual({ gap: 8, recipe: true });
          }
          const show = card.getByRole("button", {
            name: "Show logs for worker",
            exact: true,
          });
          await show.focus();
          await show.press("Space");
          await expect(
            card.getByRole("region", { name: "Logs for worker", exact: true }),
          ).toContainText("Sample service log");
          await card
            .getByRole("button", { name: "Hide logs for worker", exact: true })
            .click();
          const restart = card.getByRole("button", {
            name: "Restart service worker",
            exact: true,
          });
          await expect(restart.locator("svg")).toHaveCount(0);
          await restart.click();
          const dialog = page.getByRole("alertdialog");
          await expect(
            dialog.getByRole("button", { name: "Cancel", exact: true }),
          ).toBeFocused();
          await page.keyboard.press("Escape");
          await expect(restart).toBeFocused();
          await restart.click();
          await dialog
            .getByRole("button", { name: "Restart", exact: true })
            .click();
          const stop = card.getByRole("button", {
            name: "Stop service worker",
            exact: true,
          });
          await expect(stop).toHaveAttribute("aria-busy", "true");
          await expect(stop).toBeDisabled();
          await page
            .getByRole("button", { name: "Completar acción de muestra" })
            .click();
          await expect(stop).toBeEnabled();
          await stop.click();
          await page
            .getByRole("button", { name: "Completar acción de muestra" })
            .click();
          await expect(
            card.getByRole("button", {
              name: "Start service worker",
              exact: true,
            }),
          ).toBeVisible();
          const external = real.getByRole("link", {
            name: "Open service tidarr",
            exact: true,
          });
          await expect(external).toHaveAttribute("target", "_blank");
          await expect(external.locator("svg")).toHaveCount(1);
        }
        const pageButtons = real.getByRole("button");
        for (const button of await pageButtons.all()) {
          const box = await button.boundingBox();
          if (box && (await button.isVisible()))
            expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page
          .getByRole("radio", { name: "Cargando", exact: true })
          .click();
        await expect(
          real.getByRole("status", {
            name:
              view === "logs"
                ? "Loading worker logs"
                : "Loading stack services",
          }),
        ).toHaveAttribute("aria-busy", "true");
        await page.getByRole("radio", { name: "Vacío", exact: true }).click();
        await expect(
          real.getByText(
            view === "logs"
              ? "No log lines match the current filters."
              : "No services match the current filters.",
            { exact: true },
          ),
        ).toBeVisible();
        await page
          .getByRole("radio", { name: "Sin servicio", exact: true })
          .click();
        await expect(
          real.getByText(
            view === "logs"
              ? "Failed to load worker logs"
              : "Docker not available",
            { exact: true },
          ),
        ).toBeVisible();
        await page.getByRole("radio", { name: "Listo", exact: true }).click();
        expect(errors).toEqual([]);
        expect(requests).toEqual([]);
      });
    });
  }
test("1Z is embedded beside the published 1Y checkpoint", async ({ page }) => {
  await page.goto("/?tab=albums&listenTab=history#operaciones-admin");
  await expect(
    page.getByRole("region", { name: "Checkpoint 1Z, Logs y Stack de Admin" }),
  ).toBeVisible();
  await expect(
    page
      .frameLocator('iframe[title="Logs y Stack reales con datos de muestra"]')
      .getByRole("heading", { level: 1, name: "Logs", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Checkpoint 1Y, Superficies operativas de Admin",
    }),
  ).toContainText("Publicado");
});

for (const touch of [false, true]) {
  test.describe(`shared service filter geometry ${touch ? "touch" : "mouse"}`, () => {
    test.use({
      viewport: { width: touch ? 390 : 1440, height: 1100 },
      isMobile: touch,
      hasTouch: touch,
    });
    test("matches service filters to shared log-level chips", async ({
      page,
    }) => {
      await page.goto("/admin-operations-demo.html?page=stack");
      const real = page.getByRole("region", { name: "Página real de Admin" });
      const service = real.getByText("All", { exact: true });
      const measure = (element: Element) => {
        const style = getComputedStyle(element);
        return {
          height: element.getBoundingClientRect().height,
          radius: style.borderRadius,
          border: style.borderTopWidth,
          padding: style.paddingBlockStart,
          font: style.fontSize,
        };
      };
      const serviceGeometry = await service.evaluate(measure);
      await page
        .getByRole("navigation", { name: "Páginas de muestra" })
        .getByRole("link", { name: "Logs", exact: true })
        .click();
      const reference = real.getByRole("radio", {
        name: "All levels",
        exact: true,
      });
      const referenceGeometry = await reference.evaluate(measure);
      expect(serviceGeometry).toEqual(referenceGeometry);
      expect(referenceGeometry.height).toBe(touch ? 44 : 32);
    });
  });
}

for (const touch of [false, true]) {
  for (const view of ["logs", "stack"] as const) {
    test.describe(`summary badge geometry ${view} ${touch ? "touch" : "mouse"}`, () => {
      test.use({
        viewport: { width: touch ? 390 : 1440, height: 1100 },
        isMobile: touch,
        hasTouch: touch,
      });
      test("keeps the summary row at one informational size in live and paused states", async ({
        page,
      }) => {
        await page.goto(`/admin-operations-demo.html?page=${view}`);
        const real = page.getByRole("region", { name: "Página real de Admin" });
        const row = real
          .getByText(view === "logs" ? "3 lines" : "2/3 running", {
            exact: true,
          })
          .locator("..");
        const geometry = async () =>
          row.locator(":scope > span").evaluateAll((nodes) =>
            nodes.map((node) => {
              const style = getComputedStyle(node);
              return {
                label: node.textContent,
                height: node.getBoundingClientRect().height,
                font: style.fontSize,
                line: style.lineHeight,
                family: style.fontFamily,
                weight: style.fontWeight,
                radius: style.borderRadius,
                paddingX: style.paddingInlineStart,
                paddingY: style.paddingBlockStart,
                border: style.borderTopWidth,
              };
            }),
          );
        const assertUniform = async () => {
          const items = await geometry();
          expect(items).toHaveLength(view === "logs" ? 6 : 5);
          const { label: referenceLabel, ...reference } = items[0]!;
          for (const { label, ...current } of items)
            expect(
              current,
              `summary badge ${label} must match ${referenceLabel}`,
            ).toEqual(reference);
          await expect(row.getByRole("button")).toHaveCount(0);
          await expect(row.locator("svg")).toHaveCount(0);
        };
        await assertUniform();
        if (view === "logs") {
          await real
            .getByRole("button", { name: "Pause live", exact: true })
            .click();
          await expect(
            row.getByText("Live updates paused", { exact: true }),
          ).toBeVisible();
          await assertUniform();
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      });
    });
  }
}
